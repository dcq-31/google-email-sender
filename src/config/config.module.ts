import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { allConfigs } from './namespaces';

/**
 * Loads `.env` and registers the namespaced config providers (`src/config/namespaces/*.config.ts`),
 * eagerly instantiated at boot so invalid configuration fails fast. `isGlobal` exports every
 * `xConfig.KEY` token app-wide for injection with `@Inject(xConfig.KEY)`.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      load: allConfigs,
    }),
  ],
})
export class AppConfigModule {}
