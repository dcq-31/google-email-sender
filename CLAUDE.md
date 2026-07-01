# CLAUDE.md — `google-email-sender`

Project context for AI assistants. Read this first, then the spec under
[`specs/001-google-email-sender/`](specs/001-google-email-sender/).

## What this is

A shared, multi-tenant NestJS microservice that sends emails **via SMTP** (Gmail SMTP + App Password
by default; any SMTP server works). Producers
(one deployment per tenant) publish send-requests to **RabbitMQ** using the Outbox pattern; this
service implements the **Inbox pattern** — dedupe, persist, retry, audit — and a retention cleanup.

This is **Spec-Driven Development (SDD)**. The Markdown under `specs/` and `.specify/` is the source
of truth: change the spec/plan/data-model **before** changing behavior, then keep code and tests in sync.

## Where things live

| Area | Path |
|---|---|
| Constitution (principles) | [.specify/memory/constitution.md](.specify/memory/constitution.md) |
| Spec / plan / data-model / contracts / tasks | [specs/001-google-email-sender/](specs/001-google-email-sender/) |
| Config (zod env validation + `registerAs` namespaces) | [src/config/](src/config/), [src/config/namespaces/](src/config/namespaces/) |
| Clock abstraction (`CLOCK` token) | [src/common/clock/](src/common/clock/) |
| Entity + migration | [src/email/entities/email.entity.ts](src/email/entities/email.entity.ts), [src/database/migrations/](src/database/migrations/) |
| Persistence (claim/transitions) | [src/email/email.repository.ts](src/email/email.repository.ts) |
| Ingest (Inbox consumer) | [src/email/ingest/email-ingest.consumer.ts](src/email/ingest/email-ingest.consumer.ts) |
| Worker (claim→send→resolve) | [src/email/worker/email-worker.service.ts](src/email/worker/email-worker.service.ts) |
| Mailer port + SMTP adapter | [src/email/mailer/](src/email/mailer/) |
| Cleanup CLI command | [src/commands/cleanup.command.ts](src/commands/cleanup.command.ts) |
| Test doubles (FakeClock, FakeMailer, Testcontainers) | [test/support/](test/support/) |

## Non-negotiable rules (from the constitution)

1. **Inbox/idempotency** — dedupe is enforced by the DB unique constraint `(tenant_id, message_id)`;
   ACK RabbitMQ only after a durable persist; a duplicate is a logged no-op ACK.
2. **Clock** — never call `new Date()` / `Date.now()` / SQL `now()` in domain code. Inject `CLOCK`.
   The worker passes `clock.now()` into SQL as a bound parameter.
3. **Concurrency** — claim rows atomically with `FOR UPDATE SKIP LOCKED`. Never add an app-level claim.
4. **Test-first** — pure logic → unit; persistence/concurrency → integration (real Postgres); the
   broker→DB→send path → e2e.
5. **Config** — env-only, validated at boot (fail-fast), no secrets in git.
6. **Ports & adapters** — the worker depends on `MailerPort`, not on `nodemailer`.

## Gotchas (learned while building)

- **TypeORM `dataSource.query()` returns a `[rows, affected]` tuple** for bare `UPDATE/DELETE … RETURNING`.
  We therefore wrap data-modifying statements in a CTE selected by a top-level `SELECT`
  (see `claimBatch` / `deleteOldSuccess`) so `query()` returns plain rows.
- **UUID v7 is generated app-side** (`uuidv7` pkg) — Postgres 17.5 has no native `uuidv7()`.
- Status enum value is **`fail`** (not "failed"), matching the requirement's enum list.
- Migrations & CLI run through ts-node (`typeorm-ts-node-commonjs`); the standalone DataSource
  loads `.env` via Node's `process.loadEnvFile`.
- **Mailer is SMTP via nodemailer** (`SmtpMailerService`) — nodemailer builds the MIME message and
  RFC 2047-encodes non-ASCII subjects, so there is no hand-rolled MIME. The real send path is covered
  by an integration test against a **Mailpit** container (`test/support/mailpit.testcontainer.ts`,
  `test/integration/smtp-mailer.int-spec.ts`); unit and e2e tests still use `FakeMailer`.

## Commands

```bash
pnpm install
docker compose up -d postgres rabbitmq   # dependencies only (for host-run dev)
pnpm migration:run                   # apply migrations
pnpm start:dev                       # run consumer + worker + health endpoint
pnpm cli email:cleanup               # prune old success rows
pnpm cli email:send-test <to>        # send one test email via the configured SMTP mailer

# Full stack in Docker (deps + one-shot `migrate` + `app` on :3000, /health probe):
docker compose up -d --build         # app waits for `migrate` to complete before starting

pnpm test                            # unit (no Docker)
pnpm test:integration                # integration (Testcontainers — needs Docker)
pnpm test:e2e                        # end-to-end (Testcontainers)
pnpm build && pnpm lint
```

Container: multi-stage `Dockerfile` (Node 24, pnpm via corepack, non-root). Migrations run as a
separate step via the standard `typeorm` CLI against compiled `dist/database/data-source.js`
(`migration:run:prod`) — never on app boot. The prod image runs `node dist/main.js`.

Env: copy `.env.example` → `.env`. On a host where 5432 is taken, set `POSTGRES_PORT` and the
matching `DATABASE_URL` port (this repo's `.env` uses 5440 locally). For real sending set
`SMTP_USER`/`SMTP_PASSWORD` to a Gmail address + App Password; for local dev without real creds,
run the optional `mailpit` compose service and point `SMTP_HOST=localhost SMTP_PORT=1025 SMTP_SECURE=false`
(catch mail at http://localhost:8025).

## Conventions

- TypeScript, NestJS modules; `module: nodenext`, `isolatedModules` on → import type-only names
  used in **decorated** constructor params with `import { TOKEN, type Iface }`.
- DB columns are snake_case; entity properties camelCase.
- New env vars: add to `.env.example`, the zod schema in `src/config/env.validation.ts`, and the
  relevant namespace in `src/config/namespaces/*.config.ts` (a `registerAs('<ns>', () => …)` reading
  from `loadEnv()`). Consume it with `@Inject(xConfig.KEY) private readonly x: ConfigType<typeof xConfig>`.
