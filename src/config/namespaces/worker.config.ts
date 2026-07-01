import { registerAs } from '@nestjs/config';
import { loadEnv } from '../env.validation';

/** `worker` configuration namespace — the in-process poll loop. */
export const workerConfig = registerAs('worker', () => {
  const env = loadEnv();
  return {
    enabled: env.WORKER_ENABLED,
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    claimBatchSize: env.WORKER_CLAIM_BATCH_SIZE,
  };
});
