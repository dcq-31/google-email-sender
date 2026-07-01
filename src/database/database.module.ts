import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config/namespaces';
import { Email } from '../email/entities/email.entity';

/**
 * Wires TypeORM from the `database` config namespace. Schema is managed by migrations only
 * (`synchronize: false`); migrations are run explicitly via the CLI, never on boot.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (databaseConf: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres' as const,
        url: databaseConf.url,
        entities: [Email],
        synchronize: false,
        migrationsRun: false,
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
