import { type ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CleanupCommand } from '../../src/commands/cleanup.command';
import { emailConfig } from '../../src/config/namespaces';
import { Email } from '../../src/email/entities/email.entity';
import {
  EmailRepository,
  NewEmailInput,
} from '../../src/email/email.repository';
import { FakeClock } from '../support/fake-clock';
import {
  startPostgres,
  StartedPostgres,
  truncateEmails,
} from '../support/postgres.testcontainer';

const baseInput: NewEmailInput = {
  tenantId: 't1',
  tenantName: 'Acme',
  appName: 'billing',
  messageId: 'm-1',
  recipient: 'to@example.com',
  subject: 'Hello',
  body: 'Body',
};

function emailCfg(): ConfigType<typeof emailConfig> {
  return {
    maxAttempts: 5,
    retryBaseDelaySeconds: 60,
    retryMaxDelaySeconds: 3600,
    successRetentionDays: 30,
    cleanupBatchSize: 2, // small batch to exercise the loop
  };
}

describe('CleanupCommand (integration, real Postgres)', () => {
  let pg: StartedPostgres;
  let dataSource: DataSource;
  let clock: FakeClock;
  let repo: EmailRepository;

  beforeAll(async () => {
    pg = await startPostgres();
    dataSource = pg.dataSource;
  }, 180_000);

  afterAll(async () => {
    await dataSource?.destroy();
    await pg?.container?.stop();
  });

  beforeEach(async () => {
    await truncateEmails(dataSource);
    clock = new FakeClock('2026-06-30T00:00:00.000Z');
    repo = new EmailRepository(dataSource, clock);
  });

  it('deletes only success rows older than retention, looping over batches (AC-6.*)', async () => {
    // 5 old successes at T0
    for (let i = 0; i < 5; i++) {
      const { id } = await repo.insertPending({
        ...baseInput,
        messageId: `old-${i}`,
      });
      await repo.claimBatch(10);
      await repo.markSuccess(id!);
    }
    // advance 40 days; 1 recent success + 1 pending survive
    clock.advanceDays(40);
    const { id: recentId } = await repo.insertPending({
      ...baseInput,
      messageId: 'recent',
    });
    await repo.claimBatch(10);
    await repo.markSuccess(recentId!);
    await repo.insertPending({ ...baseInput, messageId: 'pending' });

    // run cleanup "now" = T0 + 40 days → cutoff = now - 30d → the 5 old successes qualify
    const command = new CleanupCommand(repo, clock, emailCfg());
    await command.run();

    const remaining = await dataSource.getRepository(Email).count();
    expect(remaining).toBe(2); // recent success + pending
  });

  it('is a no-op when nothing is old enough', async () => {
    const { id } = await repo.insertPending(baseInput);
    await repo.claimBatch(10);
    await repo.markSuccess(id!);

    const command = new CleanupCommand(repo, clock, emailCfg());
    await command.run();

    expect(await dataSource.getRepository(Email).count()).toBe(1);
  });
});
