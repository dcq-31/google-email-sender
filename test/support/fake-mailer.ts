import {
  MailerPort,
  OutboundEmail,
} from '../../src/email/interfaces/mailer.port';

/**
 * In-memory {@link MailerPort} for tests. Records every send and can be told to fail
 * a configurable number of upcoming sends (to exercise the retry/backoff path).
 */
export class FakeMailer implements MailerPort {
  readonly sent: OutboundEmail[] = [];
  private failuresRemaining = 0;
  private failWith: Error = new Error('FakeMailer: simulated send failure');

  /** Make the next `count` sends throw. */
  failNext(count: number, error?: Error): void {
    this.failuresRemaining = count;
    if (error) this.failWith = error;
  }

  /** Make every send throw until reset. */
  failAlways(error?: Error): void {
    this.failuresRemaining = Number.POSITIVE_INFINITY;
    if (error) this.failWith = error;
  }

  reset(): void {
    this.sent.length = 0;
    this.failuresRemaining = 0;
  }

  send(email: OutboundEmail): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return Promise.reject(this.failWith);
    }
    this.sent.push(email);
    return Promise.resolve();
  }
}
