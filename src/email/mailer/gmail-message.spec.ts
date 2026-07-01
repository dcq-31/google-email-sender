import { buildRawEmail } from './gmail-message';

function decode(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf-8');
}

describe('buildRawEmail', () => {
  it('produces a base64url-encoded MIME message with the expected headers and body', () => {
    const raw = buildRawEmail('sender@me.com', {
      recipient: 'to@example.com',
      subject: 'Hello',
      body: '<p>Hi there</p>',
    });
    const mime = decode(raw);

    expect(mime).toContain('From: sender@me.com');
    expect(mime).toContain('To: to@example.com');
    expect(mime).toContain('Subject: Hello');
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
    // headers separated from body by a blank line
    expect(mime).toContain('\r\n\r\n<p>Hi there</p>');
  });

  it('is valid base64url (no +, /, or = padding)', () => {
    const raw = buildRawEmail('s@me.com', {
      recipient: 'a@b.co',
      subject: 's',
      body: 'b',
    });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('MIME-encodes non-ASCII subjects (RFC 2047)', () => {
    const raw = buildRawEmail('s@me.com', {
      recipient: 'a@b.co',
      subject: 'Factura número ¡lista!',
      body: 'b',
    });
    const mime = decode(raw);
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  });
});
