import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import type { Channel, ConsumeMessage } from 'amqplib';
import { EMAIL_SENDER_ROUTING_KEY } from '../constants/email-ingest.constants';
import { EmailIngestService } from '../services/email-ingest.service';

/**
 * RabbitMQ transport adapter for the Inbox consumer (native NestJS `Transport.RMQ`).
 * Delegates the decision to {@link EmailIngestService} and performs the manual ack/nack —
 * we run the transport with `noAck: false`, so every message must be explicitly resolved
 * (ACK only after a durable persist; Constitution I).
 */
@Controller()
export class EmailIngestController {
  private readonly logger = new Logger(EmailIngestController.name);

  constructor(private readonly ingest: EmailIngestService) {}

  @EventPattern(EMAIL_SENDER_ROUTING_KEY)
  async handle(@Payload() msg: unknown, @Ctx() ctx: RmqContext): Promise<void> {
    const channel = ctx.getChannelRef() as Channel;
    const original = ctx.getMessage() as ConsumeMessage;
    try {
      const decision = await this.ingest.ingest(msg);
      if (decision === 'ack') {
        channel.ack(original);
      } else {
        channel.nack(original, false, decision === 'requeue');
      }
    } catch (err) {
      // Unexpected (non-decision) error — requeue so we don't silently drop a message.
      this.logger.error(
        `Unexpected ingest error; requeueing: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      channel.nack(original, false, true);
    }
  }
}
