import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString, IsUrl } from 'class-validator';

export class TimConfigSchema {
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
