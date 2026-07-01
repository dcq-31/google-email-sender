# AGENTS.md — `google-email-sender`

Canonical project context for AI coding agents (Claude Code, Cursor, Copilot, Aider, etc.).
`CLAUDE.md` is a symlink to this file, so every tool reads the same content. Read this first,
then the spec under [`specs/001-google-email-sender/`](specs/001-google-email-sender/).

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
| Bootstrap (HTTP + RMQ hybrid app) | [src/main.ts](src/main.ts) |
| Config (zod env validation + `registerAs` namespaces) | [src/config/](src/config/), [src/config/namespaces/](src/config/namespaces/) |
| Clock abstraction (`CLOCK` token) | [src/common/clock/](src/common/clock/) |
| Entity | [src/email/entities/email.entity.ts](src/email/entities/email.entity.ts) |
| Status enum | [src/email/enums/email-status.enum.ts](src/email/enums/email-status.enum.ts) |
| Migration | [src/database/migrations/](src/database/migrations/) |
| Persistence (claim/transitions) | [src/email/repositories/email.repository.ts](src/email/repositories/email.repository.ts) |
| Ingest (Inbox controller + service) | [src/email/controllers/email-ingest.controller.ts](src/email/controllers/email-ingest.controller.ts), [src/email/services/email-ingest.service.ts](src/email/services/email-ingest.service.ts) |
| Worker (claim→send→resolve) | [src/email/services/email-worker.service.ts](src/email/services/email-worker.service.ts) |
| Backoff helper | [src/email/helpers/backoff.ts](src/email/helpers/backoff.ts) |
| Mailer port + SMTP adapter | [src/email/interfaces/mailer.port.ts](src/email/interfaces/mailer.port.ts), [src/email/services/smtp-mailer.service.ts](src/email/services/smtp-mailer.service.ts) |
| Inbound DTO (zod-validated payload) | [src/email/dto/incoming-email.dto.ts](src/email/dto/incoming-email.dto.ts) |
| RMQ deserializer (raw JSON → `{pattern,data}`) | [src/rabbitmq/inbound-email.deserializer.ts](src/rabbitmq/inbound-email.deserializer.ts) |
| Health (liveness) endpoint | [src/health/health.controller.ts](src/health/health.controller.ts) |
| CLI commands (cleanup, send-test) | [src/commands/cleanup.command.ts](src/commands/cleanup.command.ts), [src/commands/send-test-email.command.ts](src/commands/send-test-email.command.ts) |
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
- **Migrations run differently per environment**: dev/host uses ts-node
  (`pnpm migration:run` → `typeorm-ts-node-commonjs` against `src/database/data-source.ts`);
  prod/Docker runs the compiled `dist` via the standard `typeorm` CLI
  (`pnpm migration:run:prod`, i.e. the `migrate` compose service). The app **never** migrates on
  boot (`migrationsRun: false` / `synchronize: false`). The standalone DataSource loads `.env`
  via Node's `process.loadEnvFile`.
- **Mailer is SMTP via nodemailer** (`SmtpMailerService`) — nodemailer builds the MIME message and
  RFC 2047-encodes non-ASCII subjects, so there is no hand-rolled MIME. The real send path is covered
  by an integration test against a **Mailpit** container (`test/support/mailpit.testcontainer.ts`,
  `test/integration/smtp-mailer.int-spec.ts`); unit and e2e tests still use `FakeMailer`.
- **`/health` is liveness-only** (static `{status:'ok'}`) — it does not verify Postgres/RabbitMQ.
  A dependency-checking readiness probe is a known future enhancement.

## Commands

```bash
# ── Full stack in Docker (recommended) ──────────────────────────────────────
cp .env.example .env                 # then set SMTP_USER + SMTP_PASSWORD for real sending
docker compose up -d --build         # postgres + rabbitmq + one-shot migrate + app on :3000
docker compose ps                    # app should report "healthy"
curl -s localhost:3000/health        # {"status":"ok"}

# Production override (closes host DB/broker ports, adds limits + bounded logging):
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# ── Host-run dev (deps in Docker, app on host) ──────────────────────────────
pnpm install
docker compose up -d postgres rabbitmq   # dependencies only
pnpm migration:run                       # apply migrations (ts-node)
pnpm start:dev                           # consumer + worker + /health

# ── Operations ──────────────────────────────────────────────────────────────
pnpm cli email:cleanup               # prune success rows older than EMAIL_SUCCESS_RETENTION_DAYS
pnpm cli email:send-test <to>        # send one test email via the configured SMTP mailer

# ── Tests ────────────────────────────────────────────────────────────────────
pnpm test                            # unit (no Docker)
pnpm test:integration                # integration (Testcontainers — needs Docker)
pnpm test:e2e                        # end-to-end (Testcontainers — needs Docker)
pnpm build && pnpm lint
```

Container: multi-stage `Dockerfile` (Node 24, pnpm via corepack, non-root `node` user). The prod
image runs `node dist/main.js`; migrations run as a separate ordered step (the `migrate` service).
See the README's **Production / Deployment** section for secrets, scaling, and the prod override.

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
