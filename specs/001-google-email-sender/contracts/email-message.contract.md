# Contract — Email Message (RabbitMQ)

The integration boundary between a **producer** (tenant app, Outbox pattern) and the
**google-email-sender** service (Inbox pattern).

## Transport

| Aspect | Value (env var) |
|---|---|
| Exchange | `google_email_sender` (`SENDER_RABBIT_EXCHANGE_NAME`), type `topic`, durable |
| Routing key | `email_sender` (`SENDER_RABBIT_QUEUE_ROUTING_KEY`) |
| Queue | `google_email_sender_queue` (`SENDER_RABBIT_QUEUE_NAME`), durable |
| Content type | `application/json` |
| Delivery mode | persistent (2) |

## Payload

JSON validated against [`email-message.schema.json`](./email-message.schema.json).

```json
{
  "tenantId": "11111111-2222-3333-4444-555555555555",
  "tenantName": "Acme Corp",
  "appName": "billing-api",
  "messageId": "billing-api:invoice-2026-0001",
  "recipient": "customer@example.com",
  "subject": "Your invoice is ready",
  "body": "<p>Invoice #2026-0001 attached.</p>"
}
```

## Producer responsibilities (Outbox)

1. **Stable, unique `messageId`** per logical email, reused verbatim on any republish/redelivery.
   This is the dedupe key. Recommended form: `<appName>:<businessKey>` or a UUID/ULID.
2. Publish with the content type and persistent delivery mode above.
3. Treat publishing as at-least-once; this service handles duplicates.

## Consumer guarantees (Inbox — this service)

1. **Exactly-once persistence:** a `(tenantId, messageId)` pair yields exactly one stored row.
2. **ACK semantics:**
   - Valid + newly stored → **ACK** (after commit).
   - Duplicate (`(tenantId, messageId)` already exists) → **ACK** (successful no-op, logged).
   - Schema-invalid payload → **reject without requeue** (`nack(requeue=false)`) so it doesn't hot-loop.
     (A dead-letter exchange is recommended at deploy time; out of scope for v1.)
   - Transient infrastructure error (e.g. DB unavailable) → **nack with requeue** so it is retried.
3. Sending itself is **decoupled** from ingest: the consumer only persists; a separate worker sends.
   So a slow/broken Google does not block message consumption or cause RabbitMQ redelivery storms.

## Versioning

Additive fields only within v1. A breaking change introduces a new routing key
(e.g. `email_sender.v2`) and a parallel binding.
