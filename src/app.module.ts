import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ClockModule } from './common/clock/clock.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { HealthController } from './health/health.controller';
import { AppRabbitMQModule } from './rabbitmq/rabbitmq.module';

/** Root module: config, clock, database, RabbitMQ, scheduling, and the email domain. */
@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    ScheduleModule.forRoot(),
    DatabaseModule,
    AppRabbitMQModule,
    EmailModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
