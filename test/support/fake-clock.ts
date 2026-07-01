import { Clock } from '../../src/common/clock/clock';

/** A controllable {@link Clock} for tests: time only moves when you tell it to. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(initial: Date | string | number = '2026-06-30T00:00:00.000Z') {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date | string | number): void {
    this.current = new Date(at);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceDays(days: number): void {
    this.advanceSeconds(days * 24 * 60 * 60);
  }
}
