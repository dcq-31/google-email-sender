# Research & Rationale — `google-email-sender`

Decision log for the non-obvious technical choices. Each entry: decision, why, alternatives, risks.

## UUID v7 {#uuid-v7}

- **Decision:** Generate `id` as UUID v7 **in the application** using the `uuidv7` npm package; the
  column is a plain `uuid`.
- **Why:** Postgres **17.5 has no native `uuidv7()`** (that arrived in PG18). UUID v7 is
  time-ordered, so it indexes far better than v4 for insert-heavy tables. App-side generation keeps
  the migration portable and avoids requiring a Postgres extension.
- **Alternatives:** `pg_uuidv7` extension (extra ops dependency); UUID v4 (index fragmentation);
  wait for PG18 (not our pinned version).
- **Risk:** None significant; the lib is tiny and deterministic.

## Concurrency: FOR UPDATE SKIP LOCKED

- **Decision:** Claim rows with `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED LIMIT n)
  RETURNING *` inside a transaction.
- **Why:** It is the canonical Postgres pattern for a work queue. Each worker locks and skips already
  locked rows, so multiple workers never claim the same row and never block each other.
- **Alternatives:** Advisory locks (coarser, easy to leak); `SELECT ... FOR UPDATE` without
  `SKIP LOCKED` (workers serialize and block); app-level "claim token" columns (racy, more code).
- **Implementation note:** TypeORM QueryBuilder supports `.setLock('pessimistic_write')` +
  `.setOnLocked('skip_locked')`, but to do the select-and-update atomically we run the raw CTE via a
  `QueryRunner` transaction and map rows back to entities.

## Retry backoff shape

- **Decision:** **Exponential** — `delaySeconds = EMAIL_RETRY_BASE_DELAY_SECONDS * 2^(failureCount - 1)`
  (computed after incrementing the count), with an optional cap. `nextAttemptAt = clock.now() + delay`.
- **Why:** The requirement says "taking into account `EMAIL_RETRY_BASE_DELAY_SECONDS`" without
  fixing a shape. Exponential backoff is the industry-standard way to relieve a struggling
  downstream (Google) instead of hammering it on a fixed cadence.
- **Example (base 60s):** attempt 1 fail → 60s, 2 → 120s, 3 → 240s, 4 → 480s, then `fail` at MAX=5.
- **Alternatives:** Linear (`base * count`) — simpler but worse under sustained outage; jitter — nice
  to have, deferred. Backoff lives in a pure, unit-tested function so the shape is trivial to change.

## ClockManager (testable time)

- **Decision:** Inject a `Clock` (`CLOCK` token) with `now(): Date`. `SystemClock` in production;
  `FakeClock` (settable/advanceable) in tests. Domain code and SQL receive `clock.now()` as a value.
- **Why:** The requirement mandates that time not be read directly from the system, so retry/cleanup
  windows can be exercised without sleeping. Passing the timestamp into SQL (not using `now()`) keeps
  the database consistent with the injected clock during tests.

## Dedupe scope: (tenant_id, message_id) {#dedupe-scope}

- **Decision:** Unique constraint on the **composite** `(tenant_id, message_id)`.
- **Why:** This is a multi-tenant shared service; independent tenant Outboxes can legitimately emit
  the same `messageId`. A bare global unique on `message_id` would cause one tenant's id to
  silently suppress another tenant's email. The composite preserves the Inbox guarantee per tenant.
- **Deviation note:** The requirement literally says `messageId` "must be unique in the database."
  We treat per-tenant uniqueness as the correct interpretation for a multi-tenant deployment and
  record it here (Clarification C1 in `spec.md`).

## RabbitMQ client: @golevelup/nestjs-rabbitmq

- **Decision:** `@golevelup/nestjs-rabbitmq` with `@RabbitSubscribe`.
- **Why:** Gives direct control over the **exact** exchange / queue / routing-key named in the
  requirement and over **manual ack/nack**, which the Inbox pattern needs (ACK only after commit).
- **Alternatives:** `@nestjs/microservices` RMQ transport imposes its own message envelope and is
  awkward for messages produced by an external Outbox; raw `amqplib` is more boilerplate.

## Email transport: Gmail API + OAuth2

- **Decision:** `googleapis` Gmail API (`users.messages.send`) behind a `MailerPort` interface.
- **Why:** Official, first-party Google path; the port keeps the worker vendor-agnostic and lets
  tests inject a fake mailer (no network). v1 uses a single OAuth2 refresh token from env.

## Cleanup as a CLI command: nest-commander

- **Decision:** Implement cleanup as a `nest-commander` command (`email:cleanup`), batched.
- **Why:** The requirement says "create a command." A CLI command is independently runnable
  (cron/k8s Job) and testable. Batching by `EMAIL_CLEANUP_BATCH_SIZE` bounds lock/IO footprint.
