import { Type } from 'class-transformer';
import { ArrayContains, IsNotEmpty, IsNumber, IsString, IsUrl } from 'class-validator';

import { TIM_USER_IDENTITY_COOKIE_NAME } from './tim.constants';

export class TimConfigSchema {
  @ArrayContains([TIM_USER_IDENTITY_COOKIE_NAME])
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  readonly jwtCookieNames!: string[];

  @IsNumber()
  @Type(() => Number)
  readonly tokenRevalidationIntervalMs!: number;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  readonly url!: string;
}
