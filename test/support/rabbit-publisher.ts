import { type ChannelModel, connect } from 'amqplib';

/**
 * A minimal raw-amqplib publisher used by e2e tests to imitate an *external* producer:
 * it publishes the bare email JSON to the topic exchange (no NestJS `{pattern,data}` envelope),
 * exactly as the real tenant producers do.
 */
export interface RawPublisher {
  publish(exchange: string, routingKey: string, payload: unknown): void;
  close(): Promise<void>;
}

export async function createPublisher(url: string): Promise<RawPublisher> {
  const connection: ChannelModel = await connect(url);
  const channel = await connection.createChannel();
  return {
    publish(exchange, routingKey, payload) {
      channel.publish(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(payload)),
        { persistent: true },
      );
    },
    async close() {
      await channel.close();
      await connection.close();
    },
  };
}
