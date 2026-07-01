import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClockModule } from '../common/clock/clock.module';
import { AppConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { Email } from '../email/entities/email.entity';
import { EmailRepository } from '../email/email.repository';
import { CleanupCommand } from './cleanup.command';

/**
 * Minimal module for the CLI entrypoint. Pulls in config, clock, and the database — but NOT the
 * RabbitMQ consumer or the worker, so running a command does not start background processing.
 */
@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    DatabaseModule,
    TypeOrmModule.forFeature([Email]),
  ],
  providers: [EmailRepository, CleanupCommand],
})
export class CliModule {}
