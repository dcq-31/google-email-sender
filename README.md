# google-email-sender

A shared, multi-tenant **NestJS** microservice that sends email over **SMTP** (Gmail SMTP + App
Password by default; any SMTP server works). Producers publish send-requests to **RabbitMQ** (Outbox
pattern); this service runs the **Inbox pattern** — dedupe, persist, retry with backoff, audit — on
**PostgreSQL 17.5**. It is container-first: a multi-stage `Dockerfile` + `docker-compose.yml` bring up
the app, its dependencies, and a one-shot migration with a single command.

## Quick start (Docker)

```bash
cp .env.example .env          # set SMTP_USER + SMTP_PASSWORD for real sending (see Configuration)
docker compose up -d --build  # postgres + rabbitmq + one-shot migrate + app on :3000
docker compose ps             # "app" should report "healthy"
curl -s localhost:3000/health # {"status":"ok"}
```

`postgres` and `rabbitmq` come up first; the one-shot **`migrate`** service applies migrations against
the compiled `dist/` data source and exits; **`app`** starts only once both are healthy and `migrate`
succeeded (it never migrates on boot — `synchronize:false`). Config is validated at boot and **fails
fast**: `NODE_ENV=production` requires `SMTP_USER`/`SMTP_PASSWORD`. For an end-to-end message
walk-through see [quickstart.md](./specs/001-google-email-sender/quickstart.md).

**Local SMTP without credentials:** the opt-in `mailpit` service (profile `mail`) catches mail locally.

```bash
docker compose --profile mail up -d mailpit   # then in .env: SMTP_HOST=localhost SMTP_PORT=1025 SMTP_SECURE=false
# view captured mail at http://localhost:8025
```

## Configuration

Env-only, validated by zod at boot ([env.validation.ts](./src/config/env.validation.ts)); copy
[.env.example](./.env.example) → `.env`. Defaults come from the schema.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` makes `SMTP_USER`/`SMTP_PASSWORD` **required**. |
| `HTTP_PORT` | `3000` | Port for the `/health` endpoint. |
| `DATABASE_URL` | — (required) | Postgres connection string. |
| `RABBITMQ_URL` | — (required) | AMQP connection string. |
| `SENDER_RABBIT_EXCHANGE_NAME` | `google_email_sender` | Topic exchange to bind. |
| `SENDER_RABBIT_QUEUE_NAME` | `google_email_sender_queue` | Durable consumer queue. |
| `SENDER_RABBIT_QUEUE_ROUTING_KEY` | `email_sender` | Binding routing key. |
| `RABBIT_PREFETCH` | `10` | Max unacked messages in flight (QoS). |
| `EMAIL_MAX_ATTEMPTS` | `5` | Give up after this many failed sends → status `fail`. |
| `EMAIL_RETRY_BASE_DELAY_SECONDS` | `60` | Exponential backoff base. |
| `EMAIL_RETRY_MAX_DELAY_SECONDS` | `3600` | Backoff cap. |
| `EMAIL_SUCCESS_RETENTION_DAYS` | `30` | Retention for successful rows before cleanup. |
| `EMAIL_CLEANUP_BATCH_SIZE` | `500` | Rows deleted per cleanup batch. |
| `WORKER_ENABLED` | `true` | Set `false` for ingest-only nodes. |
| `WORKER_POLL_INTERVAL_MS` | `5000` | Worker poll cadence. |
| `WORKER_CLAIM_BATCH_SIZE` | `20` | Rows claimed per tick. |
| `SMTP_HOST` | `smtp.gmail.com` | Any SMTP server works. |
| `SMTP_PORT` | `465` | `465` = implicit TLS; `587` = STARTTLS. |
| `SMTP_SECURE` | `true` | `true` for 465, `false` for 587. |
| `SMTP_USER` | `''` | **Required in production.** Gmail: address + [App Password](https://myaccount.google.com/apppasswords). |
| `SMTP_PASSWORD` | `''` | **Required in production.** |
| `SMTP_FROM` | `''` | Defaults to `SMTP_USER`. |

Inside the compose network, DB/broker hosts are the **service names** (`postgres`, `rabbitmq`) — the
`app`/`migrate` containers already get `DATABASE_URL`/`RABBITMQ_URL` overridden, so leave the
`localhost` values in `.env` for host dev. Credentials and host ports for the bundled Postgres/RabbitMQ
are set via `POSTGRES_*` / `RABBITMQ_*` (consumed by Compose, not the app).

## Operations

```bash
pnpm cli email:cleanup           # prune success emails older than EMAIL_SUCCESS_RETENTION_DAYS
pnpm cli email:send-test <to>    # send one test email via the configured SMTP mailer
```

`email:send-test` uses the live `SMTP_*` config, so success proves the real sender works; omit `<to>`
to send to yourself (`SMTP_FROM`/`SMTP_USER`), override with `--subject`/`--body`. In a running
container use `docker compose exec app node dist/cli <command>`.

## Deployment

The image and compose setup are production-oriented; the key points:

- **Image** — multi-stage `Dockerfile` (Node 24 Alpine): `builder` → `prod-deps` (keeps the `typeorm`
  CLI) → `runner` (non-root `node`, `NODE_ENV=production`, `CMD ["node","dist/main.js"]`). `HEALTHCHECK`
  hits `/health` via Node's HTTP client; `.dockerignore` excludes `.env`, `node_modules`, `dist`, tests.
- **Migrations** — a separate, ordered step, never on boot; compose's `migrate` runs before `app`.
  Elsewhere run `pnpm migration:run:prod` (compiled `dist`) first.
- **Secrets** — `.env` is git-ignored and injected at runtime, never baked in; supply `SMTP_*`,
  `DATABASE_URL`, `RABBITMQ_URL` from your secret store. Template:
  [.env.production.example](./.env.production.example).
- **Production override** — `docker-compose.prod.yml` keeps DB/broker off host ports, sets
  `restart: always`, resource limits, bounded JSON logging, and `NODE_ENV=production`:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
  ```
- **Scaling** — the worker claims rows with `FOR UPDATE SKIP LOCKED`, so multiple `app` replicas run
  safely; tune `WORKER_CLAIM_BATCH_SIZE`, `WORKER_POLL_INTERVAL_MS`, `RABBIT_PREFETCH`, or split
  ingest-only nodes (`WORKER_ENABLED=false`) from worker nodes.
- **Retention** — schedule `email:cleanup` (host cron / k8s `CronJob`) to prune old successes; failures
  are kept for audit.
- **Health** — `GET /health` is liveness-only (`{"status":"ok"}`); a readiness probe that checks
  Postgres/RabbitMQ is a future enhancement. Logs carry correlation context (tenant, app, message id,
  status) — ship stdout to your aggregator.

## Development

```bash
pnpm test                # unit — no Docker
pnpm test:integration    # integration — Postgres/Mailpit via Testcontainers (needs Docker)
pnpm test:e2e            # end-to-end — Postgres + RabbitMQ via Testcontainers (needs Docker)
```

All three suites run in [CI](./.github/workflows/ci.yml) on every push/PR. For host-run dev (deps in
Docker, app on host with reload):

```bash
pnpm install
docker compose up -d postgres rabbitmq   # dependencies only
pnpm migration:run                       # apply migrations (ts-node)
pnpm start:dev                           # consumer + worker + /health, watch mode
```

## Further reading

- [AGENTS.md](./AGENTS.md) — layout, rules, gotchas, full command list (`CLAUDE.md` symlinks to it).
- [quickstart.md](./specs/001-google-email-sender/quickstart.md) — run it locally, step by step.
- [spec.md](./specs/001-google-email-sender/spec.md) — what/why (user stories + acceptance criteria).

Full spec set under [specs/001-google-email-sender/](./specs/001-google-email-sender/).
