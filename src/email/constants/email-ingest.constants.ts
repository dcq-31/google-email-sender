/**
 * Routing key for inbound send-requests, fixed by the message contract
 * (contracts/email-message.contract.md). It is shared by:
 *  - the `@EventPattern` on {@link EmailIngestController} (which requires a *static* string), and
 *  - the RMQ transport binding in `main.ts` (queue → topic exchange bind + custom deserializer),
 * so the value the queue is bound with always matches the pattern the handler is registered under.
 */
export const EMAIL_SENDER_ROUTING_KEY = 'email_sender';
