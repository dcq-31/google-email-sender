# Implementation Plan — `google-email-sender`

Implements [`spec.md`](./spec.md). Governed by [`../../.specify/memory/constitution.md`](../../.specify/memory/constitution.md).

## Stack

| Concern | Choice |
|---|---|
| Runtime / language | Node 24, TypeScript 5.x |
| Framework | NestJS 11 |
| Database | PostgreSQL `17.5-alpine3.21` |
| ORM / migrations | TypeORM 1.x (`pg` driver) |
| Messaging | `@nestjs/microservices` (`Transport.RMQ`) + `amqplib` / `amqp-connection-manager` |
| Email | SMTP via `nodemailer` (Gmail SMTP + App Password) |
| Scheduling | `@nestjs/schedule` (`@Interval` worker loop) |
| CLI | `nest-commander` (cleanup command) |
| Config validation | `zod` + `@nestjs/config` |
| Ids | `uuidv7` (app-side UUID v7) |
| Tests | Jest + Testcontainers (Postgres & RabbitMQ) |

## Module / file layout

```
src/
  main.ts                          # bootstrap: hybrid app — HTTP (health) + native RMQ microservice + scheduler
  app.module.ts                    # wires Config, Database, Email modules (RMQ transport attached in main.ts)
  config/
    configuration.ts               # typed config factory (namespaces: app, db, rabbit, smtp, email)
    env.validation.ts              # zod schema; validate() fails fast at boot
  common/clock/
    clock.ts                       # CLOCK token + Clock interface { now(): Date }
    system-clock.ts                # production Clock
  database/
    database.module.ts             # TypeOrmModule.forRootAsync (config-driven)
    data-source.ts                 # standalone DataSource for the TypeORM CLI (migrations)
    migrations/                    # generated/handwritten migrations
  email/
    email.module.ts
    enums/email-status.enum.ts     # EmailStatus = pending|processing|success|fail
    entities/email.entity.ts       # @Entity('emails') mapping (snake_case columns)
    dto/incoming-email.dto.ts      # validated inbound shape (matches the contract)
    retry/backoff.ts               # pure: nextDelaySeconds(failureCount, baseSeconds, capSeconds?)
    email.repository.ts            # insertPending, claimBatch, markSuccess, markRetry, markFailed, deleteOldSuccess
    mailer/
      mailer.port.ts               # MailerPort interface + MAILER token
      smtp-mailer.service.ts       # nodemailer SMTP implementation
    ingest/
      email-ingest.controller.ts   # @EventPattern -> EmailIngestService; ack/nack via RmqContext
      email-ingest.service.ts      # ingest(msg): 'ack'|'drop'|'requeue' (validate -> insertPending; dedupe)
      email-ingest.constants.ts    # EMAIL_SENDER_ROUTING_KEY (shared by @EventPattern + RMQ binding)
    worker/
      email-worker.service.ts      # @Interval poll loop: claimBatch -> send -> markSuccess|Retry|Failed
  rabbitmq/
    inbound-email.deserializer.ts  # maps raw producer JSON -> { pattern, data } for the RMQ transport
  commands/
    cleanup.command.ts             # nest-commander: email:cleanup (batched delete)
    cli.module.ts                  # module bootstrapped by the CLI entrypoint
  cli.ts                           # nest-commander entrypoint (CommandFactory)
test/
  unit/                            # backoff, dto validation, worker logic (fakes), mailer raw-build
  integration/                     # repository + consumer + cleanup vs real Postgres/RabbitMQ
  e2e/                             # publish -> persist -> send(fake) -> success; retry path
  support/
    fake-clock.ts                  # settable/advanceable Clock for tests
    fake-mailer.ts                 # in-memory MailerPort (records sends, can be told to fail)
    postgres.testcontainer.ts      # boots postgres:17.5-alpine3.21, runs migrations
    rabbitmq.testcontainer.ts      # boots rabbitmq:3-management
```

## Key components

### Clock (Constitution II)
`CLOCK` DI token → `SystemClock` (prod) / `FakeClock` (tests). Every timestamp and the worker's
`$now` SQL parameter come from `clock.now()`.

### Config
`zod` schema validates `process.env` at boot (fail-fast). Exposed as typed namespaces via
`@nestjs/config`. Covers the spec's behavioral vars plus `DATABASE_URL`,
`SMTP_*` creds (host/port/secure/user/password/from), `WORKER_POLL_INTERVAL_MS`, `WORKER_CLAIM_BATCH_SIZE`.

### Ingest consumer (Inbox)
Native `@nestjs/microservices` `Transport.RMQ` (hybrid app; `/health` stays on HTTP). A custom
`InboundEmailDeserializer` maps the producer's raw JSON → `{ pattern: EMAIL_SENDER_ROUTING_KEY, data }`.
`EmailIngestController.@EventPattern(EMAIL_SENDER_ROUTING_KEY)` delegates to `EmailIngestService.ingest()`,
which validates → `repo.insertPending`, catches unique-violation (`23505`) → log + duplicate no-op, and
returns `'ack' | 'drop' | 'requeue'`. The controller maps that decision to **manual** `channel.ack(msg)` /
`channel.nack(msg, false, requeue)` via `RmqContext` (`noAck: false`): schema-invalid → `drop`
(`nack(requeue=false)`), transient error → `requeue` (`nack(requeue=true)`), stored/duplicate → `ack`.

### Worker (claim → send → resolve)
`@Interval(WORKER_POLL_INTERVAL_MS)` calls `repo.claimBatch(now, batch)` (atomic CTE w/ SKIP LOCKED).
For each claimed row: `mailer.send(...)`. On success → `markSuccess`. On error → compute
`failureCount+1`; if `>= EMAIL_MAX_ATTEMPTS` → `markFailed(error)`, else
`markRetry(error, nextAttemptAt = now + backoff(failureCount+1))`. Overlap-guarded so a slow tick
never runs concurrently with itself in one instance.

### Mailer (Ports & adapters)
`MailerPort.send({ recipient, subject, body })`. `SmtpMailerService` calls
`transport.sendMail({ from, to: recipient, subject, html: body })` via `nodemailer` (Gmail SMTP + App
Password by default); nodemailer builds the MIME message and RFC 2047-encodes non-ASCII subjects. The
real transport is verified against a Mailpit container (`test/integration/smtp-mailer.int-spec.ts`).

### Cleanup command
`nest-commander` command `email:cleanup`: loops `repo.deleteOldSuccess(olderThan, batchSize)`
(`olderThan = clock.now() - EMAIL_SUCCESS_RETENTION_DAYS`) until a batch deletes 0 rows.

## Testing strategy → see [`spec.md` §4 ACs] and `tasks.md`
- **Unit:** backoff math; DTO validation; worker decision branches (fake repo + fake mailer + fake clock).
- **Integration (Testcontainers):** real migrations; concurrent claim (no double-claim); dedupe
  unique-violation; retry/fail persistence; cleanup batching.
- **E2E:** real RabbitMQ + Postgres; publish → consume → worker(fake mailer) → `success`; and a
  fail-then-retry-then-success path using `FakeClock` + `WORKER_POLL_INTERVAL_MS` advancement.

## Deviations from raw requirements
- Dedupe on `(tenantId, messageId)` not bare `messageId` — see [`research.md`](./research.md#dedupe-scope).
- Enum value `fail` (not "failed") — matches the requirement's own enum list.
