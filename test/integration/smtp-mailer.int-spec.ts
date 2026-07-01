import { SmtpMailerService } from '../../src/email/services/smtp-mailer.service';
import { startMailpit, StartedMailpit } from '../support/mailpit.testcontainer';

/** Minimal slices of the Mailpit REST API responses we assert on. */
interface MailpitAddress {
  Name: string;
  Address: string;
}
interface MailpitListItem {
  ID: string;
  Subject: string;
}
interface MailpitList {
  messages_count: number;
  messages: MailpitListItem[];
}
interface MailpitMessage {
  ID: string;
  Subject: string;
  HTML: string;
  To: MailpitAddress[];
}

async function waitForMessage(
  apiBaseUrl: string,
  timeoutMs = 10_000,
): Promise<MailpitListItem> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${apiBaseUrl}/api/v1/messages`);
    const body = (await res.json()) as MailpitList;
    if (body.messages.length > 0) return body.messages[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Mailpit received no message within timeout');
}

/**
 * Exercises the real SMTP send path (nodemailer -> Mailpit over the wire), proving the transport and
 * on-the-wire encoding work. The non-ASCII subject verifies nodemailer's RFC 2047 encoding round-trips.
 */
describe('SmtpMailerService (integration: real SMTP via Mailpit)', () => {
  let mailpit: StartedMailpit;
  let mailer: SmtpMailerService;

  beforeAll(async () => {
    mailpit = await startMailpit();
    // Mailpit SMTP is plaintext and unauthenticated; empty user/pass makes nodemailer skip AUTH.
    mailer = new SmtpMailerService({
      host: mailpit.smtpHost,
      port: mailpit.smtpPort,
      secure: false,
      user: '',
      password: '',
      from: 'sender@example.com',
    });
  });

  afterAll(async () => {
    await mailpit?.stop();
  });

  it('delivers an email with a non-ASCII subject and HTML body', async () => {
    const subject = 'Factura número ¡lista!';
    await mailer.send({
      recipient: 'recipient@example.com',
      subject,
      body: '<p>Hola, aquí está tu factura.</p>',
    });

    const summary = await waitForMessage(mailpit.apiBaseUrl);
    const res = await fetch(
      `${mailpit.apiBaseUrl}/api/v1/message/${summary.ID}`,
    );
    const detail = (await res.json()) as MailpitMessage;

    expect(detail.To[0].Address).toBe('recipient@example.com');
    // Mailpit decodes the RFC 2047 encoded-word, so this proves the subject round-trips intact.
    expect(detail.Subject).toBe(subject);
    expect(detail.HTML).toContain('Hola, aquí está tu factura.');
  });
});
