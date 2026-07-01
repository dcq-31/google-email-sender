import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CLOCK } from '../src/common/clock/clock';
import {
  appConfig,
  databaseConfig,
  emailConfig,
  gmailConfig,
  rabbitConfig,
  workerConfig,
} from '../src/config/namespaces';
import { AppModule } from '../src/app.module';
import { Email } from '../src/email/entities/email.entity';
import { EmailStatus } from '../src/email/enums/email-status.enum';
import { EmailIngestConsumer } from '../src/email/ingest/email-ingest.consumer';
import { MAILER } from '../src/email/mailer/mailer.port';
import { EmailWorkerService } from '../src/email/worker/email-worker.service';
import { FakeClock } from './support/fake-clock';
import { FakeMailer } from './support/fake-mailer';
import {
  startPostgres,
  StartedPostgres,
} from './support/postgres.testcontainer';
import {
  startRabbitMQ,
  StartedRabbitMQ,
} from './support/rabbitmq.testcontainer';

const EXCHANGE = 'google_email_sender';
const QUEUE = 'google_email_sender_queue';
const ROUTING_KEY = 'email_sender';

function message(messageId: string) {
  return {
    tenantId: 't1',
    tenantName: 'Acme',
    appName: 'billing',
    messageId,
    recipient: 'to@example.com',
    subject: 'Hello',
    body: '<p>Hi</p>',
  };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor: condition not met within timeout');
}

describe('Email flow (e2e: RabbitMQ -> Inbox -> worker -> Gmail)', () => {
  let pg: StartedPostgres;
  let mq: StartedRabbitMQ;
  let app: INestApplication;
  let dataSource: DataSource;
  let amqp: AmqpConnection;
  let worker: EmailWorkerService;
  let consumer: EmailIngestConsumer;
  const clock = new FakeClock('2026-06-30T00:00:00.000Z');
  const mailer = new FakeMailer();

  const emails = () => dataSource.getRepository(Email);

  beforeAll(async () => {
    pg = await startPostgres();
    mq = await startRabbitMQ();
    dataSource = pg.dataSource;

    // Override each config namespace with test values (dynamic container URLs, worker off).
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(appConfig.KEY)
      .useValue({ nodeEnv: 'test', httpPort: 0 })
      .overrideProvider(databaseConfig.KEY)
      .useValue({ url: pg.url })
      .overrideProvider(rabbitConfig.KEY)
      .useValue({
        url: mq.url,
        exchange: EXCHANGE,
        queue: QUEUE,
        routingKey: ROUTING_KEY,
      })
      .overrideProvider(emailConfig.KEY)
      .useValue({
        maxAttempts: 3,
        retryBaseDelaySeconds: 60,
        retryMaxDelaySeconds: 3600,
        successRetentionDays: 30,
        cleanupBatchSize: 500,
      })
      .overrideProvider(workerConfig.KEY)
      .useValue({ enabled: false, pollIntervalMs: 999_999, claimBatchSize: 20 })
      .overrideProvider(gmailConfig.KEY)
      .useValue({
        sender: 'me',
        clientId: '',
        clientSecret: '',
        refreshToken: '',
        redirectUri: '',
      })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();

    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    await app.init();

    amqp = app.get(AmqpConnection);
    worker = app.get(EmailWorkerService);
    consumer = app.get(EmailIngestConsumer);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await dataSource?.destroy();
    await mq?.container?.stop();
    await pg?.container?.stop();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE emails');
    clock.set('2026-06-30T00:00:00.000Z');
    mailer.reset();
  });

  it('delivers a published message: pending -> processing -> success', async () => {
    await amqp.publish(EXCHANGE, ROUTING_KEY, message('happy-1'));

    // Inbox: the consumer persists a pending row.
    await waitFor(
      async () =>
        (await emails().count({ where: { messageId: 'happy-1' } })) === 1,
    );
    const pending = await emails().findOneByOrFail({ messageId: 'happy-1' });
    expect(pending.status).toBe(EmailStatus.Pending);

    // Worker claims, sends, resolves to success.
    const processed = await worker.processBatch();
    expect(processed).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].recipient).toBe('to@example.com');

    const done = await emails().findOneByOrFail({ messageId: 'happy-1' });
    expect(done.status).toBe(EmailStatus.Success);
    expect(done.sentAt).not.toBeNull();
  });

  it('retries a transient failure with backoff, then succeeds', async () => {
    await amqp.publish(EXCHANGE, ROUTING_KEY, message('retry-1'));
    await waitFor(
      async () =>
        (await emails().count({ where: { messageId: 'retry-1' } })) === 1,
    );

    // First attempt fails -> back to pending, scheduled 60s out.
    mailer.failNext(1, new Error('smtp 421 temporary'));
    await worker.processBatch();

    let row = await emails().findOneByOrFail({ messageId: 'retry-1' });
    expect(row.status).toBe(EmailStatus.Pending);
    expect(row.failureCount).toBe(1);
    expect(row.lastErrorMessage).toContain('smtp 421');
    expect(mailer.sent).toHaveLength(0);

    // Not due yet -> nothing claimed.
    expect(await worker.processBatch()).toBe(0);

    // Advance past the backoff and retry -> success.
    clock.advanceSeconds(61);
    expect(await worker.processBatch()).toBe(1);

    row = await emails().findOneByOrFail({ messageId: 'retry-1' });
    expect(row.status).toBe(EmailStatus.Success);
    expect(mailer.sent).toHaveLength(1);
  });

  it('marks fail after EMAIL_MAX_ATTEMPTS exhausted', async () => {
    await amqp.publish(EXCHANGE, ROUTING_KEY, message('doomed-1'));
    await waitFor(
      async () =>
        (await emails().count({ where: { messageId: 'doomed-1' } })) === 1,
    );

    mailer.failAlways(new Error('hard bounce'));
    // maxAttempts = 3 -> 3 attempts then fail. Advance clock past each backoff.
    await worker.processBatch(); // attempt 1 -> pending (count 1)
    clock.advanceSeconds(61);
    await worker.processBatch(); // attempt 2 -> pending (count 2)
    clock.advanceSeconds(121);
    await worker.processBatch(); // attempt 3 -> fail (count 3)

    const row = await emails().findOneByOrFail({ messageId: 'doomed-1' });
    expect(row.status).toBe(EmailStatus.Fail);
    expect(row.failureCount).toBe(3);
    expect(mailer.sent).toHaveLength(0);
  });

  it('deduplicates a redelivered messageId (Inbox no-op)', async () => {
    // Drive the consumer handler directly for a deterministic duplicate (no broker timing).
    const ack1 = await consumer.handleMessage(message('dup-1'));
    const ack2 = await consumer.handleMessage(message('dup-1'));

    expect(ack1).toBeUndefined(); // ACK (stored)
    expect(ack2).toBeUndefined(); // ACK (duplicate no-op, not an error)
    expect(await emails().count({ where: { messageId: 'dup-1' } })).toBe(1);
  });

  it('rejects a malformed message without requeue', async () => {
    const result = await consumer.handleMessage({
      tenantId: 't1',
      not: 'an email message',
    });
    // Nack(requeue=false)
    expect(result).toBeDefined();
    expect((result as { requeue: boolean }).requeue).toBe(false);
    expect(await emails().count()).toBe(0);
  });
});
