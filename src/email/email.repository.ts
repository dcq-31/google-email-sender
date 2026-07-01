import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { CLOCK, type Clock } from '../common/clock/clock';
import { Email } from './entities/email.entity';
import { EmailStatus } from './enums/email-status.enum';

/** Fields supplied by the producer when a message is ingested. */
export interface NewEmailInput {
  tenantId: string;
  tenantName: string;
  appName: string;
  messageId: string;
  recipient: string;
  subject: string;
  body: string;
}

/** Minimal projection of a row claimed by a worker for sending. */
export interface ClaimedEmail {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  /** failureCount BEFORE this attempt. */
  failureCount: number;
}

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof QueryFailedError) {
    const driverError = err.driverError as { code?: string } | undefined;
    return driverError?.code === PG_UNIQUE_VIOLATION;
  }
  return (err as { code?: string })?.code === PG_UNIQUE_VIOLATION;
}

/**
 * All persistence for the Inbox table. Time is always supplied by the {@link Clock}, never SQL
 * `now()` (Constitution II). Row claiming is atomic and concurrency-safe (Constitution III).
 */
@Injectable()
export class EmailRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get repo(): Repository<Email> {
    return this.dataSource.getRepository(Email);
  }

  /**
   * Inserts a new `pending` row. Returns `{ created: false }` when the message is a duplicate
   * (the `(tenant_id, message_id)` unique constraint rejected it) — the Inbox no-op.
   */
  async insertPending(
    input: NewEmailInput,
  ): Promise<{ created: boolean; id: string | null }> {
    const now = this.clock.now();
    const id = uuidv7();
    try {
      await this.repo.insert({
        id,
        ...input,
        status: EmailStatus.Pending,
        createdAt: now,
        nextAttemptAt: now,
        sentAt: null,
        failureCount: 0,
        lastErrorMessage: null,
      });
      return { created: true, id };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { created: false, id: null };
      }
      throw err;
    }
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
    }> = await this.dataSource.query(
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

  /** Marks a claimed row as successfully sent. */
  async markSuccess(id: string): Promise<void> {
    await this.repo.update({ id }, { status: EmailStatus.Success });
  }

  /** Records a transient failure and reschedules the row to `pending` at `nextAttemptAt`. */
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
    // Data-modifying CTE + top-level SELECT count(*), so query() returns an unambiguous row count
    // (a bare DELETE ... RETURNING yields a [rows, affected] tuple under TypeORM).
    const result: Array<{ deleted: number }> = await this.dataSource.query(
      `WITH del AS (
         DELETE FROM emails
          WHERE id IN (
              SELECT id FROM emails
               WHERE status = 'success' AND sent_at < $1
               ORDER BY sent_at
               LIMIT $2
            )
        RETURNING id
       )
       SELECT count(*)::int AS deleted FROM del`,
      [olderThan, batchSize],
    );
    return Number(result[0]?.deleted ?? 0);
  }
}
