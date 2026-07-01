import { z } from 'zod';

/**
 * Parses `"true"`/`"1"` (case-insensitive) as `true`, everything else as `false`.
 * `z.coerce.boolean()` is unsuitable: it treats the string `"false"` as truthy.
 */
const boolish = z.preprocess(
  (v) =>
    typeof v === 'string' ? ['true', '1', 'yes'].includes(v.toLowerCase()) : v,
  z.boolean(),
);

/**
 * Schema for the environment variables. Coerces strings to numbers/booleans and applies
 * the defaults documented in `.env.example` / `specs/.../spec.md` §6.
 */
export const envSchema = z
  .object({
    // App
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HTTP_PORT: z.coerce.number().int().positive().default(3000),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // RabbitMQ
    RABBITMQ_URL: z.string().min(1, 'RABBITMQ_URL is required'),
    SENDER_RABBIT_EXCHANGE_NAME: z
      .string()
      .min(1)
      .default('google_email_sender'),
    SENDER_RABBIT_QUEUE_NAME: z
      .string()
      .min(1)
      .default('google_email_sender_queue'),
    SENDER_RABBIT_QUEUE_ROUTING_KEY: z.string().min(1).default('email_sender'),

    // Email behavior
    EMAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    EMAIL_RETRY_BASE_DELAY_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60),
    EMAIL_RETRY_MAX_DELAY_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(3600),
    EMAIL_SUCCESS_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(30),
    EMAIL_CLEANUP_BATCH_SIZE: z.coerce.number().int().positive().default(500),

    // Worker
    WORKER_ENABLED: boolish.default(true),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    WORKER_CLAIM_BATCH_SIZE: z.coerce.number().int().positive().default(20),

    // Gmail (OAuth2)
    GMAIL_SENDER: z.string().min(1).default('me'),
    GMAIL_CLIENT_ID: z.string().default(''),
    GMAIL_CLIENT_SECRET: z.string().default(''),
    GMAIL_REFRESH_TOKEN: z.string().default(''),
    GMAIL_REDIRECT_URI: z
      .string()
      .default('https://developers.google.com/oauthplayground'),
  })
  // Gmail credentials are optional in dev/test (the FakeMailer is used) but mandatory in production.
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const key of [
        'GMAIL_CLIENT_ID',
        'GMAIL_CLIENT_SECRET',
        'GMAIL_REFRESH_TOKEN',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when NODE_ENV=production`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates the given raw environment, throwing a readable error and exiting fast on failure.
 * (Constitution V — config is explicit, validated, and fail-fast.)
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

let cachedEnv: Env | undefined;

/**
 * Validates `process.env` **once** (fail-fast) and memoizes the result. Each config namespace
 * (`src/config/namespaces/*.config.ts`) reads its slice from here, so validation/coercion runs a
 * single time at boot regardless of how many namespaces are loaded.
 */
export function loadEnv(): Env {
  return (cachedEnv ??= validateEnv(process.env));
}
