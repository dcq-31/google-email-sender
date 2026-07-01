import { OutboundEmail } from './mailer.port';

/** MIME "encoded-word" (RFC 2047) for header values that may contain non-ASCII. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  const isAscii = /^[\x00-\x7F]*$/.test(value);
  if (isAscii) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

/**
 * Builds an RFC-822 message and base64url-encodes it for the Gmail API
 * (`users.messages.send` expects `raw` to be a base64url-encoded MIME message).
 */
export function buildRawEmail(sender: string, email: OutboundEmail): string {
  const headers = [
    `From: ${sender}`,
    `To: ${email.recipient}`,
    `Subject: ${encodeHeader(email.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const mime = `${headers.join('\r\n')}\r\n\r\n${email.body}`;
  return Buffer.from(mime, 'utf-8').toString('base64url');
}
