import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Email } from './entities/email.entity';
import { EmailRepository } from './email.repository';
import { EmailIngestController } from './ingest/email-ingest.controller';
import { EmailIngestService } from './ingest/email-ingest.service';
import { MAILER } from './mailer/mailer.port';
import { SmtpMailerService } from './mailer/smtp-mailer.service';
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
    { provide: MAILER, useClass: SmtpMailerService },
  ],
  exports: [EmailRepository],
})
export class EmailModule {}
