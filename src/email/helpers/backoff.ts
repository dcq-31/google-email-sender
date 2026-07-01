export interface BackoffOptions {
  /** Base delay in seconds. */
  baseSeconds: number;
  /** Optional cap on the backoff delay. */
  maxSeconds?: number;
}

/**
 * Exponential backoff delay (in seconds) for a given failed-attempt count.
 *
 * `delay = baseSeconds * 2^(failureCount - 1)`, capped at `maxSeconds`.
 * `failureCount` is the post-increment count: 1 = first failure.
 *
 * Example (base 60s): 1→60, 2→120, 3→240, 4→480, ...
 */
export function nextDelaySeconds(
  failureCount: number,
  opts: BackoffOptions,
): number {
  const n = Math.max(1, Math.floor(failureCount));
  const raw = opts.baseSeconds * 2 ** (n - 1);
  return opts.maxSeconds != null ? Math.min(raw, opts.maxSeconds) : raw;
}

/** Earliest {@link Date} a retry is allowed, relative to `now`. */
export function computeNextAttemptAt(
  now: Date,
  failureCount: number,
  opts: BackoffOptions,
): Date {
  return new Date(now.getTime() + nextDelaySeconds(failureCount, opts) * 1000);
}
