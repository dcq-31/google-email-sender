import { registerAs } from '@nestjs/config';
import { loadEnv } from '../env.validation';

/**
 * `smtp` configuration namespace — SMTP transport for the mailer.
 * For Gmail: host `smtp.gmail.com`, port 465 (secure), `user` = the Gmail address and
 * `password` = a 16-char App Password (2FA must be enabled). `from` defaults to `user`.
 */
export const smtpConfig = registerAs('smtp', () => {
  const env = loadEnv();
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM || env.SMTP_USER,
  };
});
