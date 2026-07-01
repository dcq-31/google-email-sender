import { appConfig } from './app.config';
import { databaseConfig } from './database.config';
import { emailConfig } from './email.config';
import { rabbitConfig } from './rabbit.config';
import { smtpConfig } from './smtp.config';
import { workerConfig } from './worker.config';

export { appConfig } from './app.config';
export { databaseConfig } from './database.config';
export { emailConfig } from './email.config';
export { rabbitConfig } from './rabbit.config';
export { smtpConfig } from './smtp.config';
export { workerConfig } from './worker.config';

/** All configuration namespaces, for `ConfigModule.forRoot({ load })`. */
export const allConfigs = [
  appConfig,
  databaseConfig,
  rabbitConfig,
  emailConfig,
  smtpConfig,
  workerConfig,
];
