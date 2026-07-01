import { FakeMailer } from '../../test/support/fake-mailer';
import { SendTestEmailCommand } from './send-test-email.command';

const smtp = {
  host: 'smtp.test',
  port: 1025,
  secure: false,
  user: 'me@x.com',
  password: '',
  from: 'me@x.com',
};

describe('SendTestEmailCommand', () => {
  let mailer: FakeMailer;

  beforeEach(() => {
    mailer = new FakeMailer();
  });

  afterEach(() => {
    // The command sets process.exitCode on failure; keep it clean so jest exits 0.
    process.exitCode = 0;
  });

  it('sends to the given recipient with default subject/body', async () => {
    const cmd = new SendTestEmailCommand(mailer, smtp);

    await cmd.run(['to@example.com'], {});

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].recipient).toBe('to@example.com');
    expect(mailer.sent[0].subject).toBe('Test email from google-email-sender');
    expect(mailer.sent[0].body).toContain('working');
  });

  it('defaults the recipient to SMTP_FROM when none is given (self-send)', async () => {
    const cmd = new SendTestEmailCommand(mailer, smtp);

    await cmd.run([], {});

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].recipient).toBe('me@x.com');
  });

  it('passes through --subject / --body overrides', async () => {
    const cmd = new SendTestEmailCommand(mailer, smtp);

    await cmd.run(['to@example.com'], { subject: 'Hi', body: '<p>Custom</p>' });

    expect(mailer.sent[0].subject).toBe('Hi');
    expect(mailer.sent[0].body).toBe('<p>Custom</p>');
  });

  it('errors (no send, non-zero exit) when there is no recipient and no from', async () => {
    const cmd = new SendTestEmailCommand(mailer, { ...smtp, from: '' });

    await cmd.run([], {});

    expect(mailer.sent).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  it('reports failure (non-zero exit) when the mailer throws', async () => {
    mailer.failAlways(new Error('535 auth failed'));
    const cmd = new SendTestEmailCommand(mailer, smtp);

    await cmd.run(['to@example.com'], {});

    expect(mailer.sent).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });
});
