import { type ConfigType } from '@nestjs/config';
import { FakeClock } from '../../../test/support/fake-clock';
import { FakeMailer } from '../../../test/support/fake-mailer';
import { emailConfig, workerConfig } from '../../config/namespaces';
import { ClaimedEmail, EmailRepository } from '../email.repository';
import { EmailWorkerService } from './email-worker.service';

function emailCfg(
  overrides: Partial<ConfigType<typeof emailConfig>> = {},
): ConfigType<typeof emailConfig> {
  return {
    maxAttempts: 3,
    retryBaseDelaySeconds: 60,
    retryMaxDelaySeconds: 3600,
    successRetentionDays: 30,
    cleanupBatchSize: 500,
    ...overrides,
  };
}

function workerCfg(): ConfigType<typeof workerConfig> {
  return { enabled: true, pollIntervalMs: 5000, claimBatchSize: 10 };
}

function claimed(overrides: Partial<ClaimedEmail> = {}): ClaimedEmail {
  return {
    id: 'id-1',
    recipient: 'to@example.com',
    subject: 'Hi',
    body: 'Body',
    failureCount: 0,
    ...overrides,
  };
}

describe('EmailWorkerService', () => {
  let repo: jest.Mocked<
    Pick<
      EmailRepository,
      'claimBatch' | 'markSuccess' | 'markRetry' | 'markFailed'
    >
  >;
  let mailer: FakeMailer;
  let clock: FakeClock;

  function makeWorker(): EmailWorkerService {
    return new EmailWorkerService(
      repo as unknown as EmailRepository,
      mailer,
      clock,
      workerCfg(),
      emailCfg(),
    );
  }

  beforeEach(() => {
    repo = {
      claimBatch: jest.fn(),
      markSuccess: jest.fn().mockResolvedValue(undefined),
      markRetry: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    mailer = new FakeMailer();
    clock = new FakeClock('2026-06-30T00:00:00.000Z');
  });

  it('marks a row success when the send succeeds', async () => {
    repo.claimBatch.mockResolvedValue([claimed()]);
    const processed = await makeWorker().processBatch();

    expect(processed).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toEqual({
      recipient: 'to@example.com',
      subject: 'Hi',
      body: 'Body',
    });
    expect(repo.markSuccess).toHaveBeenCalledWith('id-1');
    expect(repo.markRetry).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('reschedules with exponential backoff on a transient failure below max attempts', async () => {
    repo.claimBatch.mockResolvedValue([claimed({ failureCount: 1 })]); // -> becomes 2 (< max 3)
    mailer.failNext(1, new Error('smtp 421'));

    await makeWorker().processBatch();

    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(repo.markRetry).toHaveBeenCalledTimes(1);
    const [id, failureCount, errorMessage, nextAttemptAt] =
      repo.markRetry.mock.calls[0];
    expect(id).toBe('id-1');
    expect(failureCount).toBe(2);
    expect(errorMessage).toBe('smtp 421');
    // base 60 * 2^(2-1) = 120s after now
    expect(nextAttemptAt.toISOString()).toBe('2026-06-30T00:02:00.000Z');
  });

  it('marks a row failed when the failure reaches max attempts', async () => {
    repo.claimBatch.mockResolvedValue([claimed({ failureCount: 2 })]); // -> becomes 3 (== max 3)
    mailer.failNext(1, new Error('hard bounce'));

    await makeWorker().processBatch();

    expect(repo.markRetry).not.toHaveBeenCalled();
    expect(repo.markFailed).toHaveBeenCalledWith('id-1', 3, 'hard bounce');
  });

  it('processes every claimed row in the batch', async () => {
    repo.claimBatch.mockResolvedValue([
      claimed({ id: 'a' }),
      claimed({ id: 'b' }),
      claimed({ id: 'c' }),
    ]);
    const processed = await makeWorker().processBatch();
    expect(processed).toBe(3);
    expect(repo.markSuccess).toHaveBeenCalledTimes(3);
  });

  it('guards against overlapping ticks', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    repo.claimBatch.mockReturnValueOnce(gate.then(() => [claimed()]));

    const worker = makeWorker();
    const first = worker.tick(); // enters, awaits claimBatch
    const second = await worker.tick(); // should no-op due to overlap guard

    expect(second).toBe(0);
    release();
    await first;
    expect(repo.claimBatch).toHaveBeenCalledTimes(1);
  });
});
