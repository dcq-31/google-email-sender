import { EMAIL_SENDER_ROUTING_KEY } from '../email/ingest/email-ingest.constants';
import { InboundEmailDeserializer } from './inbound-email.deserializer';

describe('InboundEmailDeserializer', () => {
  const deserializer = new InboundEmailDeserializer();

  it('wraps a raw (already JSON-parsed) payload into an event with the fixed pattern', () => {
    const payload = { tenantId: 't1', messageId: 'm-1' };
    expect(deserializer.deserialize(payload)).toEqual({
      pattern: EMAIL_SENDER_ROUTING_KEY,
      data: payload,
    });
  });

  it('passes non-object values through untouched (validated downstream)', () => {
    expect(deserializer.deserialize('garbage')).toEqual({
      pattern: EMAIL_SENDER_ROUTING_KEY,
      data: 'garbage',
    });
  });
});
