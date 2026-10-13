import { Type } from 'class-transformer';
import { IsInt, IsUrl, Max, Min } from 'class-validator';

import { SSE_HEARTBEAT_INTERVAL_MS } from '../notification/notification.constants';

export class LifecycleConfigSchema {
  @IsUrl({ require_tld: false })
  readonly privateRouterUrl!: string;

  @IsInt()
  @Min(Math.floor(SSE_HEARTBEAT_INTERVAL_MS / 1000) + 1)
  @Type(() => Number)
  readonly presenceLeaseSeconds!: number;

  @IsInt()
  @Min(500)
  @Max(1000)
  @Type(() => Number)
  readonly pollIntervalMs!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  readonly batchSize!: number;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  readonly actionLeaseSeconds!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  readonly maxAttempts!: number;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  readonly terminationGraceSeconds!: number;
}
