# Data Model — `emails` table

Single table implementing the Inbox. Database: `postgres:17.5-alpine3.21`.

## Columns

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | no | — | **UUID v7**, generated app-side (PG17 has no native `uuidv7()`; see [research](./research.md#uuid-v7)). PK. |
| `tenant_id` | `text` | no | — | Owning tenant. Audit + dedupe scope. |
| `tenant_name` | `text` | no | — | Human-readable tenant name. |
| `app_name` | `text` | no | — | Producer application name. |
| `message_id` | `text` | no | — | Producer Outbox id. Dedupe key (with `tenant_id`). |
| `recipient` | `text` | no | — | Destination email address. |
| `subject` | `text` | no | — | Email subject. |
| `body` | `text` | no | — | Email body. |
| `status` | `email_status` enum | no | `pending` | `pending` \| `processing` \| `success` \| `fail`. |
| `created_at` | `timestamptz` | no | — | Set to `clock.now()` when ingested. |
| `sent_at` | `timestamptz` | yes | `null` | Set to `clock.now()` when an attempt starts (claim). |
| `next_attempt_at` | `timestamptz` | no | — | Earliest time the row may be claimed. `clock.now()` on insert. |
| `last_error_message` | `text` | yes | `null` | Last send error. |
| `failure_count` | `integer` | no | `0` | Number of failed attempts. |

> **Naming:** DB columns are `snake_case`; the TypeORM entity exposes `camelCase` properties.

## Enum

```sql
CREATE TYPE email_status AS ENUM ('pending', 'processing', 'success', 'fail');
```
The requirement prose says "failed"; the canonical enum value is **`fail`** (matches the enum list).

## Constraints & indexes

```sql
-- Dedupe: one logical message per tenant (Inbox guarantee).
ALTER TABLE emails ADD CONSTRAINT uq_emails_tenant_message UNIQUE (tenant_id, message_id);

-- Worker hot path: claim pending rows that are due, oldest first.
CREATE INDEX ix_emails_claimable
  ON emails (next_attempt_at)
  WHERE status = 'pending';

-- Cleanup hot path: prune old successes.
CREATE INDEX ix_emails_cleanup
  ON emails (sent_at)
  WHERE status = 'success';
```

- `uq_emails_tenant_message` is what makes ingest idempotent: a redelivery raises a unique-violation
  (`23505`), which the consumer treats as a successful no-op.
- `ix_emails_claimable` is **partial** so it stays small and matches the worker's `WHERE` exactly.

## Lifecycle of a row

| Event | status | sent_at | next_attempt_at | failure_count | last_error_message |
|---|---|---|---|---|---|
| Ingested | `pending` | null | `now` | 0 | null |
| Claimed by worker | `processing` | `now` | (unchanged) | (unchanged) | (unchanged) |
| Send ok | `success` | (stays) | (unchanged) | (unchanged) | (unchanged) |
| Transient fail (`count+1 < MAX`) | `pending` | (stays) | `now + backoff(count)` | +1 | error text |
| Permanent fail (`count+1 >= MAX`) | `fail` | (stays) | (unchanged) | +1 | error text |

## Atomic claim query (concurrency-safe)

`$now` and `$batch` are bound parameters; `$now` comes from `clock.now()` (never SQL `now()`):

```sql
UPDATE emails
   SET status = 'processing', sent_at = $now
 WHERE id IN (
     SELECT id FROM emails
      WHERE status = 'pending' AND next_attempt_at <= $now
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT $batch
   )
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` lets N workers claim disjoint row sets with zero contention and zero
double-processing. This is exercised by an automated concurrency integration test.
