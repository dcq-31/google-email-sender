import { Controller, Get } from '@nestjs/common';

/** Liveness probe endpoint. */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
