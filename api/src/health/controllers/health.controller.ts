import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';

import { RabbitmqService } from '../../rabbitmq/services';

@ApiTags('health')
@Controller({ version: VERSION_NEUTRAL, path: '/health' })
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly rabbitmqService: RabbitmqService,
  ) {}

  @Get('/')
  @HealthCheck()
  @ApiOkResponse({ description: 'All health checks passed' })
  @ApiServiceUnavailableResponse({
    description: 'One or more health checks failed',
  })
  public async healthCheck(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([() => this.rabbitmqService.isHealthy()]);
  }
}
