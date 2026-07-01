import { INestApplication } from '@nestjs/common';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CLOCK } from '../src/common/clock/clock';
import {
  appConfig,
  databaseConfig,
  emailConfig,
  rabbitConfig,
  smtpConfig,
  workerConfig,
} from '../src/config/namespaces';
import { AppModule } from '../src/app.module';
import { Email } from '../src/email/entities/email.entity';
import { EmailStatus } from '../src/email/enums/email-status.enum';
import { EMAIL_SENDER_ROUTING_KEY } from '../src/email/ingest/email-ingest.constants';
import { EmailIngestService } from '../src/email/ingest/email-ingest.service';
import { MAILER } from '../src/email/mailer/mailer.port';
import { EmailWorkerService } from '../src/email/worker/email-worker.service';
import { InboundEmailDeserializer } from '../src/rabbitmq/inbound-email.deserializer';
import { FakeClock } from './support/fake-clock';
import { FakeMailer } from './support/fake-mailer';
import { createPublisher, RawPublisher } from './support/rabbit-publisher';
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
const ROUTING_KEY = EMAIL_SENDER_ROUTING_KEY;

function message(messageId: string) {
  return {
    tenantId: 't1',
    tenantName: 'Acme',
    appName: 'billing',
    messageId,
    recipient: 'adriancapote95@gmail.com',
    subject: 'Hello',
    body: '<p>Hi bro!</p>',
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

describe('Email flow (e2e: RabbitMQ -> Inbox -> worker -> SMTP)', () => {
  let pg: StartedPostgres;
  let mq: StartedRabbitMQ;
  let app: INestApplication;
  let dataSource: DataSource;
  let publisher: RawPublisher;
  let worker: EmailWorkerService;
  let ingest: EmailIngestService;
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
        prefetch: 10,
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
      .overrideProvider(smtpConfig.KEY)
      .useValue({
        host: 'smtp.test',
        port: 465,
        secure: true,
        user: '',
        password: '',
        from: 'me',
      })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();

    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    // Attach the native RMQ consumer exactly as `main.ts` does (hybrid app).
    app.connectMicroservice<MicroserviceOptions>(
      {
        transport: Transport.RMQ,
        options: {
          urls: [mq.url],
          queue: QUEUE,
          exchange: EXCHANGE,
          exchangeType: 'topic',
          routingKey: ROUTING_KEY,
          queueOptions: { durable: true },
          noAck: false,
          prefetchCount: 10,
          deserializer: new InboundEmailDeserializer(),
        },
      },
      { inheritAppConfig: true },
    );
    await app.init();
    await app.startAllMicroservices();

    publisher = await createPublisher(mq.url);
    worker = app.get(EmailWorkerService);
    ingest = app.get(EmailIngestService);
  }, 180_000);

  afterAll(async () => {
    await publisher?.close();
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
    publisher.publish(EXCHANGE, ROUTING_KEY, message('happy-1'));

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
    expect(mailer.sent[0].recipient).toBe('adriancapote95@gmail.com');

    const done = await emails().findOneByOrFail({ messageId: 'happy-1' });
    expect(done.status).toBe(EmailStatus.Success);
    expect(done.sentAt).not.toBeNull();
  });

  it('retries a transient failure with backoff, then succeeds', async () => {
    publisher.publish(EXCHANGE, ROUTING_KEY, message('retry-1'));
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
    publisher.publish(EXCHANGE, ROUTING_KEY, message('doomed-1'));
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
    // Drive the ingest decision directly for a deterministic duplicate (no broker timing).
    const first = await ingest.ingest(message('dup-1'));
    const second = await ingest.ingest(message('dup-1'));

    expect(first).toBe('ack'); // stored
    expect(second).toBe('ack'); // duplicate no-op, ACKed (not an error)
    expect(await emails().count({ where: { messageId: 'dup-1' } })).toBe(1);
  });

  it('rejects a malformed message without requeue', async () => {
    const decision = await ingest.ingest({
      tenantId: 't1',
      not: 'an email message',
    });
    expect(decision).toBe('drop'); // -> channel.nack(msg, false, false)
    expect(await emails().count()).toBe(0);
  });
});
