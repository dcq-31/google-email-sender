import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Email } from './entities/email.entity';
import { EmailRepository } from './repositories/email.repository';
import { EmailIngestController } from './controllers/email-ingest.controller';
import { EmailIngestService } from './services/email-ingest.service';
import { MAILER } from './interfaces/mailer.port';
import { SmtpMailerService } from './services/smtp-mailer.service';
import { EmailWorkerService } from './services/email-worker.service';

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
