import { Inject, Logger } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { Command, CommandRunner, Option } from 'nest-commander';
import { smtpConfig } from '../config/namespaces';
import { MAILER, type MailerPort } from '../email/interfaces/mailer.port';

interface SendTestOptions {
  subject?: string;
  body?: string;
}

/**
 * Sends one test email through the configured SMTP mailer; a success proves the real sender works
 * (same `SMTP_*` config as the running service).
 */
@Command({
  name: 'email:send-test',
  arguments: '[recipient]',
  description:
    'Send one test email through the configured SMTP mailer (recipient defaults to SMTP_FROM/SMTP_USER).',
})
export class SendTestEmailCommand extends CommandRunner {
  private readonly logger = new Logger(SendTestEmailCommand.name);

  constructor(
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(smtpConfig.KEY)
    private readonly smtp: ConfigType<typeof smtpConfig>,
  ) {
    super();
  }

  async run(inputs: string[], options: SendTestOptions): Promise<void> {
    const recipient = inputs[0] || this.smtp.from;
    if (!recipient) {
      this.logger.error(
        'No recipient given and SMTP_FROM/SMTP_USER is empty. Pass one: pnpm cli email:send-test you@example.com',
      );
      process.exitCode = 1;
      return;
    }

    const subject = options.subject ?? 'Test email from google-email-sender';
    const body = options.body ?? '<p>✅ Your SMTP mailer is working.</p>';

    this.logger.log(
      `Sending test email via ${this.smtp.host}:${this.smtp.port} -> ${recipient} ...`,
    );
    try {
      await this.mailer.send({ recipient, subject, body });
      this.logger.log('Test email sent successfully.');
    } catch (err) {
      this.logger.error(
        `Failed to send: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
  }

  @Option({
    flags: '-s, --subject <subject>',
    description: 'Override the subject',
  })
  parseSubject(value: string): string {
    return value;
  }

  @Option({ flags: '-b, --body <body>', description: 'Override the HTML body' })
  parseBody(value: string): string {
    return value;
  }
}
