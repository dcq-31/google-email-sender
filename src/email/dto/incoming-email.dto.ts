import { z } from 'zod';

// Pragmatic email check (avoids depending on a specific zod string-format API across versions).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Schema for the RabbitMQ payload — mirrors contracts/email-message.schema.json. */
export const incomingEmailSchema = z.object({
  tenantId: z.string().min(1),
  tenantName: z.string().min(1),
  appName: z.string().min(1),
  messageId: z.string().min(1).max(255),
  recipient: z
    .string()
    .regex(EMAIL_RE, 'recipient must be a valid email address'),
  subject: z.string(),
  body: z.string(),
});

export type IncomingEmail = z.infer<typeof incomingEmailSchema>;

/** Thrown when an inbound message fails contract validation (→ nack without requeue). */
export class InvalidMessageError extends Error {
  constructor(readonly issues: string) {
    super(`Invalid email message: ${issues}`);
    this.name = 'InvalidMessageError';
  }
}

/** Validates an unknown RabbitMQ payload against the contract. */
export function parseIncomingEmail(payload: unknown): IncomingEmail {
  const result = incomingEmailSchema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new InvalidMessageError(issues);
  }
  return result.data;
}
