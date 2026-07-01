# google-email-sender

A shared, multi-tenant **NestJS** microservice that sends emails via the **Gmail API**. Send-requests
arrive over **RabbitMQ** (producers use the Outbox pattern); this service implements the **Inbox
pattern** — deduplicate, persist, retry with backoff, and audit — backed by **PostgreSQL 17.5**.

Built with **Spec-Driven Development (SDD)**: the specification is written first as version-controlled
Markdown, then the code and tests are implemented against it.

## Documentation (read in this order)

| Doc | Purpose |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Orientation for humans & AI: layout, rules, gotchas, commands. |
| [.specify/memory/constitution.md](./.specify/memory/constitution.md) | Non-negotiable engineering principles. |
| [specs/001-google-email-sender/spec.md](./specs/001-google-email-sender/spec.md) | WHAT/WHY: user stories + acceptance criteria. |
| [specs/001-google-email-sender/plan.md](./specs/001-google-email-sender/plan.md) | HOW: architecture, stack, module layout. |
| [specs/001-google-email-sender/data-model.md](./specs/001-google-email-sender/data-model.md) | The `emails` table + atomic claim SQL. |
| [specs/001-google-email-sender/research.md](./specs/001-google-email-sender/research.md) | Decision log & rationale. |
| [specs/001-google-email-sender/contracts/](./specs/001-google-email-sender/contracts/) | RabbitMQ message contract (JSON Schema). |
| [specs/001-google-email-sender/quickstart.md](./specs/001-google-email-sender/quickstart.md) | Run it locally, step by step. |
| [specs/001-google-email-sender/tasks.md](./specs/001-google-email-sender/tasks.md) | Implementation task checklist. |

## Quick start

```bash
pnpm install
cp .env.example .env                 # fill in GMAIL_* for real sending
docker compose up -d postgres rabbitmq   # dependencies only
pnpm migration:run
pnpm start:dev                       # consumer + worker + /health
```

See [quickstart.md](./specs/001-google-email-sender/quickstart.md) for publishing a test message.

## Run the whole stack in Docker

The service is containerized (multi-stage `Dockerfile`, Node 24, non-root). Compose brings up the
dependencies, applies migrations once (`migrate` service), then starts the app:

```bash
docker build -t google-email-sender .      # optional; `up --build` also builds
docker compose up -d --build               # postgres + rabbitmq + migrate + app
docker compose ps                          # app should report "healthy"
curl -s localhost:3000/health              # {"status":"ok"}
```

Migrations run as a separate, ordered step (`app` waits for `migrate` to complete) — the app never
applies schema changes on boot. Set `NODE_ENV=production` in `.env` only once `GMAIL_*` is filled,
or the app exits at boot by design (fail-fast config).

## Tests

```bash
pnpm test                # unit (no Docker)
pnpm test:integration    # integration — real Postgres via Testcontainers (needs Docker)
pnpm test:e2e            # end-to-end — Postgres + RabbitMQ via Testcontainers
```

## Operations

```bash
pnpm cli email:cleanup   # prune success emails older than EMAIL_SUCCESS_RETENTION_DAYS
```
