import { Injectable, Logger } from '@nestjs/common';
import {
  type IncomingEmail,
  InvalidMessageError,
  parseIncomingEmail,
} from '../dto/incoming-email.dto';
import { EmailRepository } from '../email.repository';

/**
 * What the transport adapter should do with an inbound message once ingest has decided:
 *  - `ack`     → stored or duplicate (a duplicate is a successful Inbox no-op)
 *  - `drop`    → schema-invalid; nack WITHOUT requeue (don't hot-loop malformed payloads)
 *  - `requeue` → transient error (e.g. DB down); nack WITH requeue to retry later
 */
export type IngestDecision = 'ack' | 'drop' | 'requeue';

/**
 * Inbox-pattern ingest logic, decoupled from the transport. Returns a decision instead of
 * ack/nack-ing directly, so it stays unit/e2e-testable without a broker (Constitution I & IV).
 * {@link EmailIngestController} maps the decision onto the RabbitMQ channel.
 */
@Injectable()
export class EmailIngestService {
  private readonly logger = new Logger(EmailIngestService.name);

  constructor(private readonly repo: EmailRepository) {}

  async ingest(msg: unknown): Promise<IngestDecision> {
    let parsed: IncomingEmail;
    try {
      parsed = parseIncomingEmail(msg);
    } catch (err) {
      if (err instanceof InvalidMessageError) {
        this.logger.warn(
          `Dropping invalid message (no requeue): ${err.message}`,
        );
        return 'drop';
      }
      throw err;
    }

    const ref = `${parsed.tenantId}/${parsed.messageId}`;
    try {
      const result = await this.repo.insertPending(parsed);
      if (result.created) {
        this.logger.log(`Ingested ${ref} (id=${result.id})`);
      } else {
        this.logger.log(`Duplicate ignored ${ref} (Inbox no-op)`);
      }
      return 'ack';
    } catch (err) {
      this.logger.error(
        `Persist failed for ${ref}; requeueing: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 'requeue';
    }
  }
}
