/** A single outbound email, vendor-agnostic. */
export interface OutboundEmail {
  recipient: string;
  subject: string;
  body: string;
}

/**
 * Port the worker depends on to actually deliver email (Constitution VII — ports & adapters).
 * Implemented by {@link GmailMailerService} in production and by a fake in tests.
 */
export interface MailerPort {
  /** Sends the email. Resolves on success; rejects (throws) on any failure. */
  send(email: OutboundEmail): Promise<void>;
}

/** DI token for {@link MailerPort}. */
export const MAILER = Symbol('MAILER');
