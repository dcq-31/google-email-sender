import { registerAs } from '@nestjs/config';
import { loadEnv } from '../env.validation';

/** `rabbit` configuration namespace — broker connection and the sender exchange/queue binding. */
export const rabbitConfig = registerAs('rabbit', () => {
  const env = loadEnv();
  return {
    url: env.RABBITMQ_URL,
    exchange: env.SENDER_RABBIT_EXCHANGE_NAME,
    queue: env.SENDER_RABBIT_QUEUE_NAME,
    routingKey: env.SENDER_RABBIT_QUEUE_ROUTING_KEY,
    prefetch: env.RABBIT_PREFETCH,
  };
});
