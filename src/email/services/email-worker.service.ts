import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { emailConfig, workerConfig } from '../../config/namespaces';
import {
  type ClaimedEmail,
  EmailRepository,
} from '../repositories/email.repository';
import { MAILER, type MailerPort } from '../interfaces/mailer.port';
import { computeNextAttemptAt } from '../helpers/backoff';

/**
 * Polls for due `pending` rows, claims them atomically, sends each, and resolves the row to
 * `success`, back to `pending` (with backoff), or to `fail` (at max attempts).
 *
 * The loop self-schedules with `setTimeout` so the interval is config-driven, and an overlap
 * guard prevents a slow tick from running concurrently with itself in one instance.
 */
@Injectable()
export class EmailWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailWorkerService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private stopped = false;

  constructor(
    private readonly repo: EmailRepository,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(workerConfig.KEY)
    private readonly worker: ConfigType<typeof workerConfig>,
    @Inject(emailConfig.KEY)
    private readonly email: ConfigType<typeof emailConfig>,
  ) {}

  onModuleInit(): void {
    if (!this.worker.enabled) {
      this.logger.warn('Worker disabled (WORKER_ENABLED=false); not polling.');
      return;
    }
    this.logger.log(
      `Worker started: every ${this.worker.pollIntervalMs}ms, batch ${this.worker.claimBatchSize}.`,
    );
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNext());
    }, this.worker.pollIntervalMs);
  }

  /** One poll cycle. Public so tests can drive it deterministically. */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      return await this.processBatch();
    } catch (err) {
      this.logger.error(
        `Worker tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    } finally {
      this.ticking = false;
    }
  }

  /** Claims and processes one batch; returns the count. */
  async processBatch(): Promise<number> {
    const claimed = await this.repo.claimBatch(this.worker.claimBatchSize);
    for (const email of claimed) {
      await this.processOne(email);
    }
    return claimed.length;
  }

  private async processOne(email: ClaimedEmail): Promise<void> {
    try {
      await this.mailer.send({
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
      });
      await this.repo.markSuccess(email.id);
    } catch (err) {
      await this.handleFailure(email, err);
    }
  }

  private async handleFailure(
    email: ClaimedEmail,
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const newFailureCount = email.failureCount + 1;

    if (newFailureCount >= this.email.maxAttempts) {
      this.logger.warn(
        `Email ${email.id} permanently failed after ${newFailureCount} attempts: ${message}`,
      );
      await this.repo.markFailed(email.id, newFailureCount, message);
      return;
    }

    const nextAttemptAt = computeNextAttemptAt(
      this.clock.now(),
      newFailureCount,
      {
        baseSeconds: this.email.retryBaseDelaySeconds,
        maxSeconds: this.email.retryMaxDelaySeconds,
      },
    );
    this.logger.log(
      `Email ${email.id} failed (attempt ${newFailureCount}); retrying at ${nextAttemptAt.toISOString()}: ${message}`,
    );
    await this.repo.markRetry(
      email.id,
      newFailureCount,
      message,
      nextAttemptAt,
    );
  }
}
