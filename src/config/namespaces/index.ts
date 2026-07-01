import { appConfig } from './app.config';
import { databaseConfig } from './database.config';
import { emailConfig } from './email.config';
import { gmailConfig } from './gmail.config';
import { rabbitConfig } from './rabbit.config';
import { workerConfig } from './worker.config';

export { appConfig } from './app.config';
export { databaseConfig } from './database.config';
export { emailConfig } from './email.config';
export { gmailConfig } from './gmail.config';
export { rabbitConfig } from './rabbit.config';
export { workerConfig } from './worker.config';

/** All configuration namespaces, for `ConfigModule.forRoot({ load })`. */
export const allConfigs = [
  appConfig,
  databaseConfig,
  rabbitConfig,
  emailConfig,
  gmailConfig,
  workerConfig,
];
