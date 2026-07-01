import { Inject, Logger } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { Command, CommandRunner } from 'nest-commander';
import { CLOCK, type Clock } from '../common/clock/clock';
import { emailConfig } from '../config/namespaces';
import { EmailRepository } from '../email/repositories/email.repository';

/** Deletes `success` emails older than `EMAIL_SUCCESS_RETENTION_DAYS`, in batches, until none remain. */
@Command({
  name: 'email:cleanup',
  description:
    'Delete successful emails older than the retention window (batched).',
})
export class CleanupCommand extends CommandRunner {
  private readonly logger = new Logger(CleanupCommand.name);

  constructor(
    private readonly repo: EmailRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(emailConfig.KEY)
    private readonly email: ConfigType<typeof emailConfig>,
  ) {
    super();
  }

  async run(): Promise<void> {
    const { successRetentionDays, cleanupBatchSize } = this.email;
    const cutoff = new Date(
      this.clock.now().getTime() - successRetentionDays * 24 * 60 * 60 * 1000,
    );

    this.logger.log(
      `Cleaning up success emails older than ${cutoff.toISOString()} (batch ${cleanupBatchSize})...`,
    );

    let total = 0;
    let deleted: number;
    do {
      deleted = await this.repo.deleteOldSuccess(cutoff, cleanupBatchSize);
      total += deleted;
      if (deleted > 0)
        this.logger.log(`  deleted ${deleted} (running total ${total})`);
    } while (deleted > 0);

    this.logger.log(`Cleanup complete. Deleted ${total} email(s).`);
  }
}
