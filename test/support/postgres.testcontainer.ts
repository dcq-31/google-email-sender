import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { CreateEmailsTable1751299200000 } from '../../src/database/migrations/1751299200000-CreateEmailsTable';
import { Email } from '../../src/email/entities/email.entity';

export interface StartedPostgres {
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
  url: string;
}

/**
 * Boots a real `postgres:17.5-alpine3.21`, connects a TypeORM DataSource, and runs the migrations.
 * Used by integration and e2e tests so the Inbox/claim SQL is exercised against the real engine.
 */
export async function startPostgres(): Promise<StartedPostgres> {
  const container = await new PostgreSqlContainer(
    'postgres:17.5-alpine3.21',
  ).start();
  const url = container.getConnectionUri();

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: [Email],
    migrations: [CreateEmailsTable1751299200000],
    synchronize: false,
  });
  await dataSource.initialize();
  await dataSource.runMigrations();

  return { container, dataSource, url };
}

/** Removes all rows between tests. */
export async function truncateEmails(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE TABLE emails');
}
