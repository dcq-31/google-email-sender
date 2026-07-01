import {
  RabbitMQContainer,
  StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';

export interface StartedRabbitMQ {
  container: StartedRabbitMQContainer;
  url: string;
}

export async function startRabbitMQ(): Promise<StartedRabbitMQ> {
  const container = await new RabbitMQContainer(
    'rabbitmq:3-management',
  ).start();
  return { container, url: container.getAmqpUrl() };
}
