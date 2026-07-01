import { registerAs } from '@nestjs/config';
import { loadEnv } from '../env.validation';

/** `database` configuration namespace — Postgres connection. */
export const databaseConfig = registerAs('database', () => {
  const env = loadEnv();
  return {
    url: env.DATABASE_URL,
  };
});
