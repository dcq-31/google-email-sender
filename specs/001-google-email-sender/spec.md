# Feature Spec: `google-email-sender` microservice

- **Feature ID:** 001-google-email-sender
- **Status:** Approved
- **Created:** 2026-06-30
- **Input:** `description-requirements.txt`

> This document describes **WHAT** the service does and **WHY**. Implementation details
> (frameworks, libraries, SQL) live in [`plan.md`](./plan.md) and [`data-model.md`](./data-model.md).

## 1. Summary

A shared, multi-tenant microservice that sends emails via Google. Producer applications (one
deployment per tenant) publish "send this email" messages to RabbitMQ using the **Outbox pattern**.
This service consumes them, sends each email exactly once via Google, and retains a persistent,
queryable record of every message for debugging and auditing.

## 2. Goals & non-goals

**Goals**
- Send each requested email exactly once, even if RabbitMQ redelivers the same message.
- Survive transient send failures via bounded, delayed retries.
- Keep a durable, queryable history of what was sent, what failed, and why.
- Be safe to scale horizontally (many worker instances, no double-sends).
- Be deterministic and fully testable (time is controllable).

**Non-goals (v1)**
- Per-tenant Google sending identities (v1 uses one shared sender identity; tenant info is metadata).
- Inbound email / receiving. Templating / rendering. Attachments. Rate-limit negotiation with Google.
- The producer side (Outbox). Producers are external; we only define the message contract they honor.

## 3. Actors

- **Producer app (tenant):** publishes email-request messages to RabbitMQ via its Outbox. Guarantees a
  stable, unique `messageId` per logical email.
- **This service (consumer + worker):** ingests, dedupes, persists, sends, retries, prunes.
- **Operator:** inspects the database for debugging; runs the cleanup command.

## 4. User stories & acceptance criteria

### US-1 — Ingest a send request (Inbox)
*As a producer, when I publish an email message, the service records it so it will be sent.*
- **AC-1.1** A valid message is stored as a new row with status `pending`, `createdAt = now`,
  `nextAttemptAt = now` (ready immediately).
- **AC-1.2** The message is acknowledged to RabbitMQ only after the row is durably committed.
- **AC-1.3** A malformed message is rejected without crashing the consumer and is not retried in a hot loop.

### US-2 — Never send twice (deduplication)
*As an operator, I need redelivered messages to not cause duplicate emails.*
- **AC-2.1** Two messages with the same dedupe key result in exactly **one** row.
- **AC-2.2** The duplicate delivery is acknowledged as a successful no-op (logged, not errored).

### US-3 — Send the email (happy path)
*As a tenant, my queued email is delivered.*
- **AC-3.1** A worker claims a `pending` row whose `nextAttemptAt <= now`, sets it to `processing`,
  and stamps `sentAt = now`.
- **AC-3.2** While claimed, no other worker can pick up the same row.
- **AC-3.3** On a successful send the row becomes `success`.

### US-4 — Retry on transient failure
*As a tenant, a temporary Google error should not lose my email.*
- **AC-4.1** On send failure, `lastErrorMessage` is stored and `failureCount` is incremented.
- **AC-4.2** If `failureCount < EMAIL_MAX_ATTEMPTS`, status returns to `pending` and `nextAttemptAt`
  is pushed into the future using a delay derived from `EMAIL_RETRY_BASE_DELAY_SECONDS`.
- **AC-4.3** A row is not retried before its `nextAttemptAt`.

### US-5 — Give up after max attempts
*As an operator, I need permanently failing emails to stop retrying and stay visible.*
- **AC-5.1** When `failureCount` reaches `EMAIL_MAX_ATTEMPTS`, status becomes `fail` and the row is
  no longer claimed by workers.
- **AC-5.2** `fail` rows are retained (not auto-deleted) with their last error.

### US-6 — Prune old successes
*As an operator, I keep storage bounded without losing recent audit history.*
- **AC-6.1** A command deletes rows with status `success` whose `sentAt` is older than
  `EMAIL_SUCCESS_RETENTION_DAYS`.
- **AC-6.2** Deletion happens in batches of `EMAIL_CLEANUP_BATCH_SIZE` until none remain.
- **AC-6.3** Non-`success` rows are never deleted by this command.

## 5. State machine

```
              claim (worker)            send ok
   pending ───────────────▶ processing ─────────▶ success
      ▲                          │
      │ transient fail           │ permanent fail
      │ (failureCount < MAX)     │ (failureCount >= MAX)
      └──────────────────────────┤
                                 ▼
                               fail
```
- `pending → processing → success`
- `pending → processing → pending` (transient failure; reschedule via backoff)
- `pending → processing → fail` (max attempts reached)

## 6. Configuration (behavioral knobs)

| Variable | Default | Meaning |
|---|---|---|
| `EMAIL_MAX_ATTEMPTS` | 5 | Failures allowed before a row becomes `fail`. |
| `EMAIL_RETRY_BASE_DELAY_SECONDS` | 60 | Base delay used to compute retry backoff. |
| `EMAIL_SUCCESS_RETENTION_DAYS` | 30 | How long `success` rows are kept before pruning. |
| `EMAIL_CLEANUP_BATCH_SIZE` | 500 | Rows deleted per batch by the cleanup command. |
| `SENDER_RABBIT_EXCHANGE_NAME` | `google_email_sender` | Exchange the producer publishes to. |
| `SENDER_RABBIT_QUEUE_NAME` | `google_email_sender_queue` | Queue this service consumes. |
| `SENDER_RABBIT_QUEUE_ROUTING_KEY` | `email_sender` | Binding/routing key. |

(Operational variables — DB DSN, Gmail OAuth credentials, worker poll interval/batch — are in
[`plan.md`](./plan.md) and `.env.example`.)

## 7. Message contract

Defined in [`contracts/email-message.contract.md`](./contracts/email-message.contract.md) and
[`contracts/email-message.schema.json`](./contracts/email-message.schema.json). The producer MUST
provide a stable, unique `messageId` (the dedupe key) generated by its Outbox.

## 8. Clarifications & resolved decisions

| # | Question | Decision |
|---|---|---|
| C1 | Dedupe scope | Unique on **`(tenantId, messageId)`** so tenants can't collide. (Requirement said "unique messageId"; rationale in [`research.md`](./research.md).) |
| C2 | Retry delay shape | **Exponential** backoff from the base delay (see `research.md`). |
| C3 | `fail` vs "failed" | Enum value is **`fail`** (per the requirement's enum list). |
| C4 | Google identity | Single shared sender (env-configured OAuth2) for v1. |
| C5 | `nextAttemptAt` filter | `pending AND nextAttemptAt <= now` (inclusive). |

## 9. Out-of-scope risks / future work

- Per-tenant Gmail credentials and per-tenant send quotas.
- Dead-letter exchange for messages that fail schema validation.
- Scheduling the cleanup command on a cron (the command exists; scheduling is deployment concern).
