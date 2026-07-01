import { Logger } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { appConfig, rabbitConfig } from './config/namespaces';
import { EMAIL_SENDER_ROUTING_KEY } from './email/constants/email-ingest.constants';
import { InboundEmailDeserializer } from './rabbitmq/inbound-email.deserializer';

/**
 * Hybrid application: an HTTP server (for the /health probe) + a native RabbitMQ microservice
 * (Transport.RMQ) that consumes send-requests. `connectMicroservice` + `startAllMicroservices`
 * attach the RMQ consumer; `listen` keeps the HTTP server up alongside it.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(); // graceful stop for the worker + RMQ consumer (OnModuleDestroy)

  const rabbit = app.get<ConfigType<typeof rabbitConfig>>(rabbitConfig.KEY);
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [rabbit.url],
        queue: rabbit.queue,
        // Bind the durable queue to the existing topic exchange with the contract's routing key.
        // Nest asserts the exchange + queue and binds them; producers keep publishing raw JSON.
        exchange: rabbit.exchange,
        exchangeType: 'topic',
        routingKey: EMAIL_SENDER_ROUTING_KEY,
        queueOptions: { durable: true },
        noAck: false, // manual ack — the controller ACKs only after a durable persist (Inbox)
        prefetchCount: rabbit.prefetch,
        // External producers send bare JSON (no NestJS {pattern,data} envelope); map it here.
        deserializer: new InboundEmailDeserializer(),
      },
    },
    { inheritAppConfig: true },
  );
  await app.startAllMicroservices();

  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  await app.listen(config.httpPort);

  Logger.log(
    `google-email-sender listening on :${config.httpPort} (env=${config.nodeEnv}); ` +
      `RMQ consumer on queue="${rabbit.queue}" exchange="${rabbit.exchange}" key="${EMAIL_SENDER_ROUTING_KEY}"`,
    'Bootstrap',
  );
}

void bootstrap();
