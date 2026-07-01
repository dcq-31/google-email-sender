import { createTransport } from 'nodemailer';
import { SmtpMailerService } from './smtp-mailer.service';

/**
 * Offline unit test: the injected `jsonTransport` resolves with zero network I/O, so we can
 * assert the `OutboundEmail` -> nodemailer message mapping without a real SMTP server.
 * (Authoritative on-the-wire encoding of non-ASCII subjects is asserted in the Mailpit int-spec.)
 */
describe('SmtpMailerService', () => {
  const config = {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'me@example.com',
    password: 'app-password',
    from: 'me@example.com',
  };

  it('maps OutboundEmail to a nodemailer message (from/to/subject/html)', async () => {
    const transport = createTransport({ jsonTransport: true });
    const sendMail = jest.spyOn(transport, 'sendMail');
    const mailer = new SmtpMailerService(config, transport);

    await mailer.send({
      recipient: 'to@example.com',
      subject: 'Factura número ¡lista!',
      body: '<p>Hola</p>',
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'me@example.com',
      to: 'to@example.com',
      subject: 'Factura número ¡lista!',
      html: '<p>Hola</p>',
    });
  });

  it('resolves through the injected transport without network I/O', async () => {
    const transport = createTransport({ jsonTransport: true });
    const mailer = new SmtpMailerService(config, transport);

    await expect(
      mailer.send({ recipient: 'x@y.z', subject: 's', body: 'b' }),
    ).resolves.toBeUndefined();
  });
});
