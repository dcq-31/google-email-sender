import { validateEnv } from './env.validation';

const baseEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
};

describe('validateEnv', () => {
  it('applies documented defaults', () => {
    const env = validateEnv({ ...baseEnv });
    expect(env.NODE_ENV).toBe('development');
    expect(env.EMAIL_MAX_ATTEMPTS).toBe(5);
    expect(env.EMAIL_RETRY_BASE_DELAY_SECONDS).toBe(60);
    expect(env.EMAIL_SUCCESS_RETENTION_DAYS).toBe(30);
    expect(env.EMAIL_CLEANUP_BATCH_SIZE).toBe(500);
    expect(env.SENDER_RABBIT_EXCHANGE_NAME).toBe('google_email_sender');
    expect(env.SENDER_RABBIT_QUEUE_NAME).toBe('google_email_sender_queue');
    expect(env.SENDER_RABBIT_QUEUE_ROUTING_KEY).toBe('email_sender');
  });

  it('coerces numeric strings to numbers', () => {
    const env = validateEnv({
      ...baseEnv,
      EMAIL_MAX_ATTEMPTS: '8',
      WORKER_POLL_INTERVAL_MS: '1000',
    });
    expect(env.EMAIL_MAX_ATTEMPTS).toBe(8);
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(1000);
  });

  it('parses booleans correctly ("false" is false, not truthy)', () => {
    expect(
      validateEnv({ ...baseEnv, WORKER_ENABLED: 'false' }).WORKER_ENABLED,
    ).toBe(false);
    expect(
      validateEnv({ ...baseEnv, WORKER_ENABLED: 'true' }).WORKER_ENABLED,
    ).toBe(true);
    expect(
      validateEnv({ ...baseEnv, WORKER_ENABLED: '1' }).WORKER_ENABLED,
    ).toBe(true);
  });

  it('throws a readable error when a required var is missing', () => {
    expect(() => validateEnv({ RABBITMQ_URL: 'amqp://x' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects non-positive numeric config', () => {
    expect(() => validateEnv({ ...baseEnv, EMAIL_MAX_ATTEMPTS: '0' })).toThrow(
      /EMAIL_MAX_ATTEMPTS/,
    );
  });

  it('requires Gmail credentials in production', () => {
    expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'production' })).toThrow(
      /GMAIL_CLIENT_ID/,
    );
    const ok = validateEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      GMAIL_CLIENT_ID: 'id',
      GMAIL_CLIENT_SECRET: 'secret',
      GMAIL_REFRESH_TOKEN: 'token',
    });
    expect(ok.NODE_ENV).toBe('production');
  });
});
