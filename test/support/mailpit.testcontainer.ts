import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

const SMTP_PORT = 1025;
const HTTP_PORT = 8025;

export interface StartedMailpit {
  container: StartedTestContainer;
  /** Host + mapped port for the plaintext SMTP listener. */
  smtpHost: string;
  smtpPort: number;
  /** Base URL of the Mailpit HTTP REST API / web UI. */
  apiBaseUrl: string;
  stop(): Promise<void>;
}

/**
 * Boots a real Mailpit (SMTP catcher + REST API) so `SmtpMailerService` can be exercised over the
 * wire. SMTP is plaintext on 1025 (no auth, no STARTTLS by default); the HTTP API/UI is on 8025.
 */
export async function startMailpit(): Promise<StartedMailpit> {
  const container = await new GenericContainer('axllent/mailpit:v1.20')
    .withExposedPorts(SMTP_PORT, HTTP_PORT)
    .withWaitStrategy(Wait.forHttp('/readyz', HTTP_PORT).forStatusCode(200))
    .start();

  return {
    container,
    smtpHost: container.getHost(),
    smtpPort: container.getMappedPort(SMTP_PORT),
    apiBaseUrl: `http://${container.getHost()}:${container.getMappedPort(HTTP_PORT)}`,
    stop: async () => {
      await container.stop();
    },
  };
}
