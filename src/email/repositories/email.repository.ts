import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { Email } from '../entities/email.entity';
import { EmailStatus } from '../enums/email-status.enum';

export interface NewEmailInput {
  tenantId: string;
  tenantName: string;
  appName: string;
  messageId: string;
  recipient: string;
  subject: string;
  body: string;
}

/** A row claimed for sending. */
export interface ClaimedEmail {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  /** failureCount BEFORE this attempt. */
  failureCount: number;
}

/**
 * All persistence for the Inbox table. Time is always supplied by the {@link Clock}, never SQL
 * `now()` (Constitution II). Row claiming is atomic and concurrency-safe (Constitution III).
 */
@Injectable()
export class EmailRepository {
  constructor(
    @InjectRepository(Email) private readonly repo: Repository<Email>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Inserts a new `pending` row. Returns `{ created: false }` when the message is a duplicate
   * (the `(tenant_id, message_id)` unique constraint rejected it) — the Inbox no-op.
   */
  async insertPending(
    input: NewEmailInput,
  ): Promise<{ created: boolean; id: string | null }> {
    const now = this.clock.now();
    const id = uuidv7();
    // `orIgnore()` → `ON CONFLICT DO NOTHING`: a duplicate `(tenant_id, message_id)` inserts no
    // row and returns nothing, so `raw.length === 0` is the Inbox no-op (no exception to catch).
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .into(Email)
      .values({
        id,
        ...input,
        status: EmailStatus.Pending,
        createdAt: now,
        nextAttemptAt: now,
        sentAt: null,
        failureCount: 0,
        lastErrorMessage: null,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const created = (result.raw as unknown[]).length > 0;
    return { created, id: created ? id : null };
  }

  /**
   * Atomically claims up to `limit` due `pending` rows, marking them `processing` and stamping
   * `sent_at`. Uses `FOR UPDATE SKIP LOCKED` so concurrent workers never claim the same row.
   */
  async claimBatch(limit: number): Promise<ClaimedEmail[]> {
    const now = this.clock.now();
    // Wrapped in a data-modifying CTE selected by a top-level SELECT so query() returns plain
    // rows (TypeORM returns a [rows, affected] tuple for bare UPDATE ... RETURNING).
    const rows: Array<{
      id: string;
      recipient: string;
      subject: string;
      body: string;
      failure_count: number;
    }> = await this.repo.query(
      `WITH claimed AS (
         UPDATE emails
            SET status = 'processing', sent_at = $1
          WHERE id IN (
              SELECT id FROM emails
               WHERE status = 'pending' AND next_attempt_at <= $1
               ORDER BY next_attempt_at
               FOR UPDATE SKIP LOCKED
               LIMIT $2
            )
        RETURNING id, recipient, subject, body, failure_count
       )
       SELECT id, recipient, subject, body, failure_count FROM claimed`,
      [now, limit],
    );

    return rows.map((r) => ({
      id: r.id,
      recipient: r.recipient,
      subject: r.subject,
      body: r.body,
      failureCount: Number(r.failure_count),
    }));
  }

  async markSuccess(id: string): Promise<void> {
    await this.repo.update({ id }, { status: EmailStatus.Success });
  }

  /** Records a transient failure and reschedules the row for retry. */
  async markRetry(
    id: string,
    failureCount: number,
    errorMessage: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.repo.update(
      { id },
      {
        status: EmailStatus.Pending,
        failureCount,
        lastErrorMessage: errorMessage,
        nextAttemptAt,
      },
    );
  }

  /** Records a permanent failure (max attempts reached); the row is no longer claimable. */
  async markFailed(
    id: string,
    failureCount: number,
    errorMessage: string,
  ): Promise<void> {
    await this.repo.update(
      { id },
      {
        status: EmailStatus.Fail,
        failureCount,
        lastErrorMessage: errorMessage,
      },
    );
  }

  /**
   * Deletes up to `batchSize` `success` rows whose `sent_at` is older than `olderThan`.
   * Returns the number deleted (0 means nothing left to prune).
   */
  async deleteOldSuccess(olderThan: Date, batchSize: number): Promise<number> {
    // Postgres has no `DELETE ... LIMIT`, so batch via `id IN (SELECT ... LIMIT n)`.
    // `DeleteResult.affected` is the deleted row count (no CTE / count(*) needed).
    const ids = this.repo
      .createQueryBuilder('e')
      .select('e.id')
      .where('e.status = :status', { status: EmailStatus.Success })
      .andWhere('e.sentAt < :olderThan', { olderThan })
      .orderBy('e.sentAt', 'ASC')
      .limit(batchSize);

    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .from(Email)
      .where(`id IN (${ids.getQuery()})`)
      .setParameters(ids.getParameters())
      .execute();

    return result.affected ?? 0;
  }
}
