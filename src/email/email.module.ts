import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Email } from './entities/email.entity';
import { EmailRepository } from './email.repository';
import { EmailIngestController } from './ingest/email-ingest.controller';
import { EmailIngestService } from './ingest/email-ingest.service';
import { GmailMailerService } from './mailer/gmail-mailer.service';
import { MAILER } from './mailer/mailer.port';
import { EmailWorkerService } from './worker/email-worker.service';

/**
 * Core domain module: persistence (repository), ingest (Inbox consumer via native RMQ transport),
 * sending (worker + mailer). The RMQ server itself is wired in `main.ts`; here we register the
 * `@EventPattern` controller and its decision service. Relies on the globally-provided Clock/config.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Email])],
  controllers: [EmailIngestController],
  providers: [
    EmailRepository,
    EmailIngestService,
    EmailWorkerService,
    { provide: MAILER, useClass: GmailMailerService },
  ],
  exports: [EmailRepository],
})
export class EmailModule {}
