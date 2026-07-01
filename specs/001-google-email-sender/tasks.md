# Tasks — `google-email-sender`

Ordered, test-first. `[P]` = parallelizable with siblings. Each task lists the AC(s) it satisfies
(see [`spec.md`](./spec.md)) and its test. Mark `[x]` when its tests pass.

## Phase 0 — Foundation
- [x] **T001** Docker Compose (`postgres:17.5-alpine3.21`, `rabbitmq:3-management`) + `.env.example`.
- [x] **T002** Config: `zod` env schema + `@nestjs/config` namespaces; fail-fast `validate()`.
      *Test:* unit — invalid env throws; defaults applied. (Constitution V)
- [x] **T003** `Clock` interface + `CLOCK` token + `SystemClock`; `FakeClock` test support.
      *Test:* unit — FakeClock set/advance. (Constitution II)

## Phase 1 — Persistence
- [x] **T010** `EmailStatus` enum + `Email` entity (snake_case columns, UUIDv7 default app-side).
- [x] **T011** TypeORM `DataSource` + `DatabaseModule` + first migration (table, enum,
      `uq_emails_tenant_message`, partial indexes). (data-model.md)
- [x] **T012** `backoff.ts` pure function. *Test:* unit — exponential growth from base; cap; count=0/1 edges. (AC-4.2)

## Phase 2 — Repository (integration, real Postgres)
- [x] **T020** `repo.insertPending` (UUIDv7, status pending, createdAt/nextAttemptAt = now). *Test:* AC-1.1.
- [x] **T021** `repo.insertPending` dedupe — second `(tenantId, messageId)` raises unique-violation.
      *Test:* AC-2.1 (one row; 23505 surfaced as a typed duplicate signal).
- [x] **T022** `repo.claimBatch(now, batch)` atomic CTE + SKIP LOCKED → rows become `processing`,
      `sentAt=now`; respects `nextAttemptAt <= now` and `status='pending'`. *Test:* AC-3.1.
- [x] **T023 [P]** Concurrency: two parallel `claimBatch` calls claim **disjoint** rows, none twice.
      *Test:* AC-3.2 (Constitution III).
- [x] **T024 [P]** `markSuccess` / `markRetry(error, nextAttemptAt)` / `markFailed(error)` transitions
      persist correctly (status, failure_count++, last_error_message). *Test:* AC-3.3/4.1/4.2/5.1.
- [x] **T025 [P]** `repo.deleteOldSuccess(olderThan, batchSize)` deletes only `success` older than cutoff,
      returns deleted count. *Test:* AC-6.1/6.3.

## Phase 3 — Ingest (Inbox)
- [x] **T030** `IncomingEmailDto` + validation matching the contract. *Test:* unit — accepts valid, rejects malformed. (AC-1.3)
- [x] **T031** `EmailIngestConsumer` `@RabbitSubscribe(exchange/queue/routingKey from env)`:
      persist→ACK; duplicate→ACK no-op; invalid→nack(no requeue); infra error→nack(requeue).
      *Test:* integration — AC-1.1/1.2/2.1/2.2.

## Phase 4 — Send
- [x] **T040** `MailerPort` + `MAILER` token; `FakeMailer` (records sends; can be told to fail).
- [x] **T041** `GmailMailerService` builds RFC-822 → base64url → `users.messages.send`.
      *Test:* unit — raw message is well-formed (To/Subject/body), googleapis client mocked.
- [x] **T042** `EmailWorkerService` `@Interval` loop: claim→send→resolve; overlap guard.
      *Test:* unit — success→`success`; fail<MAX→`pending`+backoff; fail==MAX→`fail` (fake repo/mailer/clock).
      AC-3.3/4.1/4.2/4.3/5.1.

## Phase 5 — Cleanup command
- [x] **T050** `cleanup.command.ts` (`email:cleanup`) loops `deleteOldSuccess` in batches until 0.
      *Test:* integration — AC-6.1/6.2/6.3 with `FakeClock`.

## Phase 6 — Wiring & E2E
- [x] **T060** `AppModule`, `RabbitMQModule`, `main.ts` bootstrap; `cli.ts` + `CliModule`.
- [x] **T061** E2E happy path: publish → row `pending` → worker → `success` (FakeMailer). All AC-3.
- [x] **T062** E2E retry path: mailer fails once → `pending` + backoff → advance clock → `success`. AC-4.
- [x] **T063** E2E dedupe: publish same `messageId` twice → one row, one send. AC-2.

## Phase 7 — Docs / analyze
- [x] **T070** `CLAUDE.md` accurate to scripts/structure; README run section.
- [x] **T071** Analyze pass: every AC maps to a passing test; constitution principles honored.
