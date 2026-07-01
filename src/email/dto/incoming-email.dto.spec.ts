import { InvalidMessageError, parseIncomingEmail } from './incoming-email.dto';

const valid = {
  tenantId: 't1',
  tenantName: 'Acme',
  appName: 'billing',
  messageId: 'm-1',
  recipient: 'to@example.com',
  subject: 'Hello',
  body: 'Body',
};

describe('parseIncomingEmail', () => {
  it('accepts a valid message', () => {
    expect(parseIncomingEmail(valid)).toEqual(valid);
  });

  it('rejects a missing required field', () => {
    const { messageId, ...rest } = valid;
    void messageId;
    expect(() => parseIncomingEmail(rest)).toThrow(InvalidMessageError);
  });

  it('rejects an invalid recipient address', () => {
    expect(() =>
      parseIncomingEmail({ ...valid, recipient: 'not-an-email' }),
    ).toThrow(/recipient/);
  });

  it('rejects non-object payloads', () => {
    expect(() => parseIncomingEmail(null)).toThrow(InvalidMessageError);
    expect(() => parseIncomingEmail('a string')).toThrow(InvalidMessageError);
  });

  it('allows an empty subject/body (present but empty)', () => {
    expect(
      parseIncomingEmail({ ...valid, subject: '', body: '' }),
    ).toMatchObject({
      subject: '',
      body: '',
    });
  });
});
