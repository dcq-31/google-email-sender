import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClockModule } from '../common/clock/clock.module';
import { AppConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { Email } from '../email/entities/email.entity';
import { EmailRepository } from '../email/repositories/email.repository';
import { MAILER } from '../email/interfaces/mailer.port';
import { SmtpMailerService } from '../email/services/smtp-mailer.service';
import { CleanupCommand } from './cleanup.command';
import { SendTestEmailCommand } from './send-test-email.command';

/**
 * Minimal module for the CLI entrypoint. Pulls in config, clock, and the database — but NOT the
 * RabbitMQ consumer or the worker, so running a command does not start background processing.
 * `MAILER` is registered here (not imported from EmailModule) so `email:send-test` can send without
 * pulling in the worker.
 */
@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    DatabaseModule,
    TypeOrmModule.forFeature([Email]),
  ],
  providers: [
    EmailRepository,
    CleanupCommand,
    { provide: MAILER, useClass: SmtpMailerService },
    SendTestEmailCommand,
  ],
})
export class CliModule {}
