import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Email } from './entities/email.entity';
import { EmailRepository } from './email.repository';
import { EmailIngestConsumer } from './ingest/email-ingest.consumer';
import { GmailMailerService } from './mailer/gmail-mailer.service';
import { MAILER } from './mailer/mailer.port';
import { EmailWorkerService } from './worker/email-worker.service';

/**
 * Core domain module: persistence (repository), ingest (Inbox consumer), sending (worker + mailer).
 * Relies on the globally-provided RabbitMQ connection, Clock, and config.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Email])],
  providers: [
    EmailRepository,
    EmailIngestConsumer,
    EmailWorkerService,
    { provide: MAILER, useClass: GmailMailerService },
  ],
  exports: [EmailRepository],
})
export class EmailModule {}
