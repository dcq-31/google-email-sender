import { CommandFactory } from 'nest-commander';
import { CliModule } from './commands/cli.module';

/** Entrypoint for CLI commands (e.g. `email:cleanup`). */
async function bootstrap(): Promise<void> {
  await CommandFactory.run(CliModule, ['warn', 'error', 'log']);
}

void bootstrap();
