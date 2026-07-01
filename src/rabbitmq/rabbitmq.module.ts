import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Global, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { rabbitConfig } from '../config/namespaces';

/**
 * Connects to RabbitMQ and declares the sender exchange from the `rabbit` config namespace.
 * Re-exports golevelup's {@link RabbitMQModule} so `AmqpConnection` is injectable elsewhere.
 */
@Global()
@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      inject: [rabbitConfig.KEY],
      useFactory: (rabbitConf: ConfigType<typeof rabbitConfig>) => ({
        uri: rabbitConf.url,
        exchanges: [{ name: rabbitConf.exchange, type: 'topic' }],
        connectionInitOptions: { wait: true, timeout: 20_000 },
      }),
    }),
  ],
  exports: [RabbitMQModule],
})
export class AppRabbitMQModule {}
