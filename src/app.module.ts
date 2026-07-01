import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ClockModule } from './common/clock/clock.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { HealthController } from './health/health.controller';

// The RabbitMQ consumer is a native NestJS microservice (Transport.RMQ) wired in `main.ts` via
// `app.connectMicroservice`; there is no broker module to import here (the app never publishes).
@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    ScheduleModule.forRoot(),
    DatabaseModule,
    EmailModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
