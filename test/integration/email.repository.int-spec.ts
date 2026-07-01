import { DataSource } from 'typeorm';
import { Email } from '../../src/email/entities/email.entity';
import {
  EmailRepository,
  NewEmailInput,
} from '../../src/email/repositories/email.repository';
import { EmailStatus } from '../../src/email/enums/email-status.enum';
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

describe('EmailRepository (integration, real Postgres)', () => {
  let pg: StartedPostgres;
  let dataSource: DataSource;
  let repo: EmailRepository;
  let clock: FakeClock;

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
    repo = new EmailRepository(dataSource.getRepository(Email), clock);
  });

  const find = (id: string) =>
    dataSource.getRepository(Email).findOneByOrFail({ id });
  const count = () => dataSource.getRepository(Email).count();

  it('inserts a pending row that is ready to send immediately (AC-1.1)', async () => {
    const result = await repo.insertPending(baseInput);
    expect(result.created).toBe(true);
    expect(result.id).toBeTruthy();

    const row = await find(result.id!);
    expect(row.status).toBe(EmailStatus.Pending);
    expect(row.failureCount).toBe(0);
    expect(row.sentAt).toBeNull();
    expect(row.createdAt.toISOString()).toBe(clock.now().toISOString());
    expect(row.nextAttemptAt.toISOString()).toBe(clock.now().toISOString());
  });

  it('deduplicates a repeated (tenantId, messageId) (AC-2.1)', async () => {
    const first = await repo.insertPending(baseInput);
    const second = await repo.insertPending(baseInput);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBeNull();
    expect(await count()).toBe(1);
  });

  it('allows the same messageId for different tenants (composite dedupe key)', async () => {
    await repo.insertPending(baseInput);
    await repo.insertPending({ ...baseInput, tenantId: 't2' });
    expect(await count()).toBe(2);
  });

  it('claimBatch marks due pending rows processing and stamps sentAt (AC-3.1)', async () => {
    const { id } = await repo.insertPending(baseInput);
    const claimed = await repo.claimBatch(10);

    expect(claimed.map((c) => c.id)).toContain(id);
    const row = await find(id!);
    expect(row.status).toBe(EmailStatus.Processing);
    expect(row.sentAt?.toISOString()).toBe(clock.now().toISOString());
  });

  it('does not claim rows scheduled in the future, then claims once due (AC-4.3)', async () => {
    const { id } = await repo.insertPending(baseInput);
    await repo.claimBatch(10); // -> processing
    await repo.markRetry(
      id!,
      1,
      'transient',
      new Date(clock.now().getTime() + 60_000),
    );

    expect(await repo.claimBatch(10)).toHaveLength(0); // not due yet

    clock.advanceSeconds(61);
    const claimedNow = await repo.claimBatch(10);
    expect(claimedNow.map((c) => c.id)).toContain(id);
  });

  it('claims concurrently without ever double-claiming a row (SKIP LOCKED) (AC-3.2)', async () => {
    const total = 50;
    for (let i = 0; i < total; i++) {
      await repo.insertPending({ ...baseInput, messageId: `m-${i}` });
    }

    const [a, b, c] = await Promise.all([
      repo.claimBatch(total),
      repo.claimBatch(total),
      repo.claimBatch(total),
    ]);
    const claimedIds = [...a, ...b, ...c].map((e) => e.id);

    expect(claimedIds).toHaveLength(total); // every row claimed exactly once across workers
    expect(new Set(claimedIds).size).toBe(total); // no id claimed twice
  });

  it('transitions a claimed row to success (AC-3.3)', async () => {
    const { id } = await repo.insertPending(baseInput);
    await repo.claimBatch(10);
    await repo.markSuccess(id!);
    expect((await find(id!)).status).toBe(EmailStatus.Success);
  });

  it('records a retry with incremented failureCount, error, and next attempt (AC-4.1/4.2)', async () => {
    const { id } = await repo.insertPending(baseInput);
    await repo.claimBatch(10);
    const next = new Date(clock.now().getTime() + 120_000);
    await repo.markRetry(id!, 2, 'smtp 421', next);

    const row = await find(id!);
    expect(row.status).toBe(EmailStatus.Pending);
    expect(row.failureCount).toBe(2);
    expect(row.lastErrorMessage).toBe('smtp 421');
    expect(row.nextAttemptAt.toISOString()).toBe(next.toISOString());
  });

  it('records a permanent failure (AC-5.1)', async () => {
    const { id } = await repo.insertPending(baseInput);
    await repo.claimBatch(10);
    await repo.markFailed(id!, 5, 'hard bounce');

    const row = await find(id!);
    expect(row.status).toBe(EmailStatus.Fail);
    expect(row.failureCount).toBe(5);
    expect(row.lastErrorMessage).toBe('hard bounce');
  });

  it('deleteOldSuccess deletes only old successes, batched (AC-6.1/6.2/6.3)', async () => {
    // 3 old successes at T0
    const oldIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await repo.insertPending({
        ...baseInput,
        messageId: `old-${i}`,
      });
      oldIds.push(id!);
    }
    await repo.claimBatch(10); // sentAt = T0
    for (const id of oldIds) await repo.markSuccess(id);

    // +40 days; 2 recent successes
    clock.advanceDays(40);
    for (let i = 0; i < 2; i++) {
      const { id } = await repo.insertPending({
        ...baseInput,
        messageId: `recent-${i}`,
      });
      await repo.claimBatch(10); // sentAt = T0 + 40d
      await repo.markSuccess(id!);
    }
    // a fail + a pending that must survive
    const { id: failId } = await repo.insertPending({
      ...baseInput,
      messageId: 'failed',
    });
    await repo.claimBatch(10);
    await repo.markFailed(failId!, 5, 'dead');
    await repo.insertPending({ ...baseInput, messageId: 'pending' });

    // cutoff = T0 + 30d → only the 3 old successes qualify
    const cutoff = new Date(
      Date.parse('2026-06-30T00:00:00.000Z') + 30 * 24 * 60 * 60 * 1000,
    );

    expect(await repo.deleteOldSuccess(cutoff, 2)).toBe(2); // batch limited
    expect(await repo.deleteOldSuccess(cutoff, 2)).toBe(1);
    expect(await repo.deleteOldSuccess(cutoff, 2)).toBe(0); // nothing left

    expect(await count()).toBe(4);
  });
});
