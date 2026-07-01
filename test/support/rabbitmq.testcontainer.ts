import {
  RabbitMQContainer,
  StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';

export interface StartedRabbitMQ {
  container: StartedRabbitMQContainer;
  url: string;
}

/** Boots a real `rabbitmq:3-management` and returns its AMQP URL. */
export async function startRabbitMQ(): Promise<StartedRabbitMQ> {
  const container = await new RabbitMQContainer(
    'rabbitmq:3-management',
  ).start();
  return { container, url: container.getAmqpUrl() };
}
