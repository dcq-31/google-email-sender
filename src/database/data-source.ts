import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Email } from '../email/entities/email.entity';

// Load .env for standalone CLI usage (migrations). Node >=20.12 / 24 ships process.loadEnvFile.
// .env is optional — in CI the environment is provided directly.
try {
  (
    process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }
  ).loadEnvFile?.(join(process.cwd(), '.env'));
} catch {
  /* no .env file present — rely on the ambient environment */
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Email],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: process.env.TYPEORM_LOGGING === 'true',
};

/** Default export consumed by the TypeORM CLI (`typeorm -d src/database/data-source.ts`). */
export default new DataSource(dataSourceOptions);
