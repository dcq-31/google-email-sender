import {
  AmqpConnection,
  Nack,
  SubscribeResponse,
} from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { rabbitConfig } from '../../config/namespaces';
import {
  type IncomingEmail,
  InvalidMessageError,
  parseIncomingEmail,
} from '../dto/incoming-email.dto';
import { EmailRepository } from '../email.repository';

/**
 * Inbox-pattern consumer. Binds the configured exchange/queue/routing-key at runtime, validates
 * each message, and persists it. ACK semantics (Constitution I):
 *  - stored or duplicate → ACK (duplicate is a successful no-op)
 *  - schema-invalid      → Nack(requeue=false)  (don't hot-loop malformed payloads)
 *  - transient DB error  → Nack(requeue=true)   (retry later)
 */
@Injectable()
export class EmailIngestConsumer implements OnModuleInit {
  private readonly logger = new Logger(EmailIngestConsumer.name);

  constructor(
    private readonly amqp: AmqpConnection,
    private readonly repo: EmailRepository,
    @Inject(rabbitConfig.KEY)
    private readonly rabbit: ConfigType<typeof rabbitConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    const { exchange, queue, routingKey } = this.rabbit;
    await this.amqp.createSubscriber<unknown>(
      (msg) => this.handleMessage(msg),
      {
        exchange,
        routingKey,
        queue,
        queueOptions: { durable: true },
        createQueueIfNotExists: true,
      },
      'handleMessage',
    );
    this.logger.log(
      `Subscribed to exchange="${exchange}" queue="${queue}" routingKey="${routingKey}"`,
    );
  }

  async handleMessage(msg: unknown): Promise<SubscribeResponse> {
    let parsed: IncomingEmail;
    try {
      parsed = parseIncomingEmail(msg);
    } catch (err) {
      if (err instanceof InvalidMessageError) {
        this.logger.warn(
          `Dropping invalid message (no requeue): ${err.message}`,
        );
        return new Nack(false);
      }
      throw err;
    }

    try {
      const result = await this.repo.insertPending(parsed);
      const ref = `${parsed.tenantId}/${parsed.messageId}`;
      if (result.created) {
        this.logger.log(`Ingested ${ref} (id=${result.id})`);
      } else {
        this.logger.log(`Duplicate ignored ${ref} (Inbox no-op)`);
      }
      return undefined; // ACK
    } catch (err) {
      this.logger.error(
        `Persist failed for ${parsed.tenantId}/${parsed.messageId}; requeueing: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return new Nack(true); // transient — requeue
    }
  }
}
