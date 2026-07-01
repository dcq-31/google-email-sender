import { Deserializer, IncomingEvent } from '@nestjs/microservices';
import { EMAIL_SENDER_ROUTING_KEY } from '../email/ingest/email-ingest.constants';

/**
 * Maps a raw, non-NestJS payload into the `{ pattern, data }` envelope the transport expects.
 *
 * External producers publish the bare email JSON (no NestJS `{ pattern, data }` wrapper), so the
 * default deserializer would yield `pattern: undefined` and drop the payload. `ServerRMQ` already
 * `JSON.parse`s the message body before calling us (so `value` is the parsed object) and does not
 * expose the delivery routing key here — but every message on this queue is an `email_sender`
 * request, so we stamp a fixed pattern. That pattern is matched (exact) against the
 * `@EventPattern(EMAIL_SENDER_ROUTING_KEY)` handler. Omitting `id` makes it an event (fire-and-forget).
 *
 * Malformed bodies need no special handling: `parseMessageContent` falls back to a string, which
 * fails Zod validation downstream and is nacked-without-requeue by the ingest decision logic.
 */
export class InboundEmailDeserializer implements Deserializer<
  unknown,
  IncomingEvent
> {
  deserialize(value: unknown): IncomingEvent {
    return { pattern: EMAIL_SENDER_ROUTING_KEY, data: value };
  }
}
