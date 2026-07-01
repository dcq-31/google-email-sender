import { Logger } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { appConfig } from './config/namespaces';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableShutdownHooks(); // so the worker stops cleanly (OnModuleDestroy)

  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  await app.listen(config.httpPort);

  Logger.log(
    `google-email-sender listening on :${config.httpPort} (env=${config.nodeEnv})`,
    'Bootstrap',
  );
}

void bootstrap();
