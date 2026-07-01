import { computeNextAttemptAt, nextDelaySeconds } from './backoff';

describe('nextDelaySeconds', () => {
  const base = { baseSeconds: 60 };

  it('grows exponentially from the base delay', () => {
    expect(nextDelaySeconds(1, base)).toBe(60); // 60 * 2^0
    expect(nextDelaySeconds(2, base)).toBe(120); // 60 * 2^1
    expect(nextDelaySeconds(3, base)).toBe(240); // 60 * 2^2
    expect(nextDelaySeconds(4, base)).toBe(480); // 60 * 2^3
  });

  it('clamps a failureCount below 1 to the first-attempt delay', () => {
    expect(nextDelaySeconds(0, base)).toBe(60);
    expect(nextDelaySeconds(-5, base)).toBe(60);
  });

  it('caps the delay at maxSeconds', () => {
    const opts = { baseSeconds: 60, maxSeconds: 300 };
    expect(nextDelaySeconds(3, opts)).toBe(240); // under cap
    expect(nextDelaySeconds(4, opts)).toBe(300); // 480 capped to 300
    expect(nextDelaySeconds(10, opts)).toBe(300); // far over cap
  });
});

describe('computeNextAttemptAt', () => {
  it('adds the delay (seconds) to now', () => {
    const now = new Date('2026-06-30T00:00:00.000Z');
    const at = computeNextAttemptAt(now, 2, { baseSeconds: 60 }); // +120s
    expect(at.toISOString()).toBe('2026-06-30T00:02:00.000Z');
  });

  it('does not mutate the input date', () => {
    const now = new Date('2026-06-30T00:00:00.000Z');
    computeNextAttemptAt(now, 3, { baseSeconds: 60 });
    expect(now.toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });
});
