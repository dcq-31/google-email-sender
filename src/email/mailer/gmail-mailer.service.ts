import { Inject, Injectable, Logger } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { google, gmail_v1 } from 'googleapis';
import { gmailConfig } from '../../config/namespaces';
import { buildRawEmail } from './gmail-message';
import { MailerPort, OutboundEmail } from './mailer.port';

/**
 * {@link MailerPort} backed by the Gmail API with an OAuth2 refresh token.
 * Constructing the OAuth2/Gmail clients performs no network I/O; the token is exchanged lazily
 * on the first `send`.
 */
@Injectable()
export class GmailMailerService implements MailerPort {
  private readonly logger = new Logger(GmailMailerService.name);
  private readonly gmail: gmail_v1.Gmail;
  private readonly sender: string;

  constructor(@Inject(gmailConfig.KEY) config: ConfigType<typeof gmailConfig>) {
    const { clientId, clientSecret, refreshToken, redirectUri, sender } =
      config;
    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials({ refresh_token: refreshToken });
    this.gmail = google.gmail({ version: 'v1', auth });
    this.sender = sender;
  }

  async send(email: OutboundEmail): Promise<void> {
    const raw = buildRawEmail(this.sender, email);
    await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    this.logger.debug(`Sent email to ${email.recipient}`);
  }
}
