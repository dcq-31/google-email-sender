import { Controller, Get } from '@nestjs/common';

/** Liveness endpoint for orchestrators (k8s, compose healthchecks). */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
