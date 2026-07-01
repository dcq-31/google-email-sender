import { registerAs } from '@nestjs/config';
import { loadEnv } from '../env.validation';

/** `gmail` configuration namespace — OAuth2 credentials for the Gmail API sender. */
export const gmailConfig = registerAs('gmail', () => {
  const env = loadEnv();
  return {
    sender: env.GMAIL_SENDER,
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
    redirectUri: env.GMAIL_REDIRECT_URI,
  };
});
