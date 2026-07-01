import { registerAs } from '@nestjs/config';
import { loadEnv } from '../env.validation';

/** `app` configuration namespace — HTTP server and runtime environment. */
export const appConfig = registerAs('app', () => {
  const env = loadEnv();
  return {
    nodeEnv: env.NODE_ENV,
    httpPort: env.HTTP_PORT,
  };
});
