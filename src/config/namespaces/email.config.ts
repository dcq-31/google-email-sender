import { registerAs } from '@nestjs/config';
import { loadEnv } from '../env.validation';

/** `email` configuration namespace — retry policy and retention/cleanup knobs. */
export const emailConfig = registerAs('email', () => {
  const env = loadEnv();
  return {
    maxAttempts: env.EMAIL_MAX_ATTEMPTS,
    retryBaseDelaySeconds: env.EMAIL_RETRY_BASE_DELAY_SECONDS,
    retryMaxDelaySeconds: env.EMAIL_RETRY_MAX_DELAY_SECONDS,
    successRetentionDays: env.EMAIL_SUCCESS_RETENTION_DAYS,
    cleanupBatchSize: env.EMAIL_CLEANUP_BATCH_SIZE,
  };
});
