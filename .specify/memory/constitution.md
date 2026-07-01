# Constitution — `google-email-sender`

> Non-negotiable principles. Every spec, plan, task, and line of code must comply.
> When a requirement and a principle conflict, surface the conflict — do not silently break a principle.

## I. Idempotency is sacred (Inbox pattern)

RabbitMQ delivers **at least once**. The same `messageId` may arrive multiple times. The service
MUST persist each message exactly once and send each email exactly once.

- The dedupe key is enforced by a database **unique constraint**, never by application-level checks alone.
- A message is **ACKed only after** its row is durably committed (or proven to be a duplicate).
- A duplicate delivery is a **successful no-op**: log it, ACK it, never throw.

## II. Time flows through the Clock

No domain code calls `new Date()`, `Date.now()`, or SQL `now()` directly. All "current time" comes
from the injected `Clock` (`CLOCK` token). The worker passes `clock.now()` into SQL as a bound
parameter so behavior is fully deterministic under a `FakeClock` in tests.

## III. Concurrency-safe by construction

Multiple worker instances run in parallel (multi-tenant, horizontally scaled). Claiming a message
MUST be atomic: `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *`.
No two workers may ever process the same row. This is verified by an automated concurrency test.

## IV. Test-first (TDD)

Each behavior begins with a failing test. Pure logic (backoff, state transitions) is unit-tested;
persistence and concurrency are integration-tested against a **real Postgres** (Testcontainers);
the full RabbitMQ→DB→send→resolve path is covered by an E2E test with a faked Gmail transport.

## V. Config is explicit, validated, and secret-free

All configuration is read from environment variables, validated at boot with a schema, and the
process **fails fast** on invalid/missing values. No secrets (Gmail OAuth tokens, DB passwords)
are committed. `.env.example` documents every variable; real values live only in `.env`/secrets.

## VI. Persist for audit, then prune

Every message — sent, failed, or duplicate-skipped — is observable in the database for debugging.
Successful emails are retained for `EMAIL_SUCCESS_RETENTION_DAYS`, then deleted in bounded batches.
Failed (`fail`) rows are kept (not auto-pruned) so permanent failures stay visible.

## VII. Ports & adapters

Domain logic depends on **interfaces**, not vendors. The worker depends on `MailerPort`, not on
`googleapis`. This keeps Gmail swappable and lets tests inject a fake mailer with zero network I/O.

## VIII. Observable

Structured logs carry correlation context (`tenantId`, `appName`, `messageId`, `status`) on every
ingest, claim, send, retry, failure, and cleanup. Failures always record `lastErrorMessage`.

---

### Amendment log
- `2026-06-30` — v1.0.0 — Initial constitution ratified alongside spec `001-google-email-sender`.
