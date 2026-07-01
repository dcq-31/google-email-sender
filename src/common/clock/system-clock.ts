import { Injectable } from '@nestjs/common';
import { Clock } from './clock';

/** Production {@link Clock} backed by the system wall clock. */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
