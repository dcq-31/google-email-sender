# Quickstart — `google-email-sender`

## Prerequisites
- Node 24, pnpm, Docker.

## 1. Install & configure
```bash
pnpm install
cp .env.example .env       # then fill in GMAIL_* OAuth2 credentials
```

## 2. Start infrastructure
```bash
docker compose up -d        # postgres:17.5-alpine3.21 + rabbitmq:3-management
```
- RabbitMQ UI: http://localhost:15672 (guest/guest)
- Postgres: localhost:5432

## 3. Run migrations
```bash
pnpm migration:run
```

## 4. Run the service
```bash
pnpm start:dev
```
This starts the HTTP health endpoint, the RabbitMQ consumer (Inbox), and the worker loop.

## 5. Publish a test message
Publish JSON to exchange `google_email_sender` with routing key `email_sender` (RabbitMQ UI →
Exchanges → publish message), payload per
[`contracts/email-message.schema.json`](./contracts/email-message.schema.json):
```json
{ "tenantId":"t1","tenantName":"Acme","appName":"billing","messageId":"demo-1",
  "recipient":"to@example.com","subject":"Hi","body":"Hello" }
```
Then inspect the row:
```bash
docker compose exec postgres psql -U postgres -d email_sender -c \
  "select message_id,status,failure_count,next_attempt_at from emails order by created_at desc limit 5;"
```
- Publish the **same `messageId`** again → still one row (Inbox dedupe).

## 6. Run the cleanup command
```bash
pnpm cli email:cleanup
```

## 7. Tests
```bash
pnpm test                 # unit
pnpm test:integration     # integration (Testcontainers — needs Docker)
pnpm test:e2e             # end-to-end (Testcontainers)
```

## Key env vars
See `.env.example`. Behavioral: `EMAIL_MAX_ATTEMPTS`, `EMAIL_RETRY_BASE_DELAY_SECONDS`,
`EMAIL_SUCCESS_RETENTION_DAYS`, `EMAIL_CLEANUP_BATCH_SIZE`. Messaging: `SENDER_RABBIT_*`.
Ops: `DATABASE_URL`, `GMAIL_*`, `WORKER_POLL_INTERVAL_MS`, `WORKER_CLAIM_BATCH_SIZE`.
