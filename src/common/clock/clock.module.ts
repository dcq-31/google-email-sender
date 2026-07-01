import { Global, Module } from '@nestjs/common';
import { CLOCK } from './clock';
import { SystemClock } from './system-clock';

/** Provides the {@link Clock} application-wide. Override the {@link CLOCK} token in tests. */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
