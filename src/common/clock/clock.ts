/**
 * Abstraction over "the current time" so that time can be controlled in tests.
 * Constitution II — no domain code calls `new Date()` / `Date.now()` / SQL `now()` directly;
 * it depends on this interface instead.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');
