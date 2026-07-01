import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { smtpConfig } from '../../config/namespaces';
import { MailerPort, OutboundEmail } from '../interfaces/mailer.port';

/**
 * {@link MailerPort} backed by SMTP via nodemailer (e.g. Gmail SMTP + App Password).
 * nodemailer builds the MIME message and RFC 2047-encodes non-ASCII subjects itself.
 */
@Injectable()
export class SmtpMailerService implements MailerPort {
  private readonly logger = new Logger(SmtpMailerService.name);
  private readonly from: string;

  /**
   * `@Optional()` on `transport` makes Nest pass `undefined` (it isn't a provider), so the default
   * builds the real SMTP transport at runtime. Tests can still pass a zero-I/O transport
   * (e.g. `createTransport({ jsonTransport: true })`) to avoid hitting the network.
   */
  constructor(
    @Inject(smtpConfig.KEY) config: ConfigType<typeof smtpConfig>,
    @Optional()
    private readonly transport: Transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
    }),
  ) {
    this.from = config.from;
  }

  async send(email: OutboundEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email.recipient,
      subject: email.subject,
      html: email.body,
    });
    this.logger.debug(`Sent email to ${email.recipient}`);
  }
}
