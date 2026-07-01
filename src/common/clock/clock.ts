/**
 * Abstraction over "the current time" so that time can be controlled in tests.
 * Constitution II — no domain code calls `new Date()` / `Date.now()` / SQL `now()` directly;
 * it depends on this interface instead.
 */
export interface Clock {
  /** The current instant. */
  now(): Date;
}

/** DI token for {@link Clock}. */
export const CLOCK = Symbol('CLOCK');
