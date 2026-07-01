# Implementation Plan — `google-email-sender`

Implements [`spec.md`](./spec.md). Governed by [`../../.specify/memory/constitution.md`](../../.specify/memory/constitution.md).

## Stack

| Concern | Choice |
|---|---|
| Runtime / language | Node 24, TypeScript 5.x |
| Framework | NestJS 11 |
| Database | PostgreSQL `17.5-alpine3.21` |
| ORM / migrations | TypeORM 1.x (`pg` driver) |
| Messaging | `@golevelup/nestjs-rabbitmq` |
| Email | Gmail API via `googleapis` (OAuth2) |
| Scheduling | `@nestjs/schedule` (`@Interval` worker loop) |
| CLI | `nest-commander` (cleanup command) |
| Config validation | `zod` + `@nestjs/config` |
| Ids | `uuidv7` (app-side UUID v7) |
| Tests | Jest + Testcontainers (Postgres & RabbitMQ) |

## Module / file layout

```
src/
  main.ts                          # bootstrap: HTTP (health) + Rabbit consumer + scheduler
  app.module.ts                    # wires Config, Database, RabbitMQ, Email modules
  config/
    configuration.ts               # typed config factory (namespaces: app, db, rabbit, gmail, email)
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
      gmail-mailer.service.ts      # googleapis OAuth2 implementation
    ingest/
      email-ingest.consumer.ts     # @RabbitSubscribe -> repo.insertPending; dedupe; ack/nack
    worker/
      email-worker.service.ts      # @Interval poll loop: claimBatch -> send -> markSuccess|Retry|Failed
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
`GMAIL_*` OAuth2 creds, `WORKER_POLL_INTERVAL_MS`, `WORKER_CLAIM_BATCH_SIZE`.

### Ingest consumer (Inbox)
`@RabbitSubscribe({ exchange, queue, routingKey })`. Validates payload → `repo.insertPending`.
Catches unique-violation (`23505`) → log + ACK (duplicate no-op). Schema-invalid → `nack(requeue=false)`.
Other errors → rethrow → `nack(requeue=true)`. (golevelup ACKs on resolve, nacks on throw; we set
`errorHandler`/`nack` options accordingly.)

### Worker (claim → send → resolve)
`@Interval(WORKER_POLL_INTERVAL_MS)` calls `repo.claimBatch(now, batch)` (atomic CTE w/ SKIP LOCKED).
For each claimed row: `mailer.send(...)`. On success → `markSuccess`. On error → compute
`failureCount+1`; if `>= EMAIL_MAX_ATTEMPTS` → `markFailed(error)`, else
`markRetry(error, nextAttemptAt = now + backoff(failureCount+1))`. Overlap-guarded so a slow tick
never runs concurrently with itself in one instance.

### Mailer (Ports & adapters)
`MailerPort.send({ recipient, subject, body })`. `GmailMailerService` builds an RFC-822 message,
base64url-encodes it, calls `gmail.users.messages.send({ userId: 'me', requestBody: { raw } })`.

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
