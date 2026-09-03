import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

import { TransformStringToBoolean } from '../transformers';

export class ValkeyConfigSchema {
  @IsString()
  @IsNotEmpty()
  readonly host!: string;

  @IsInt()
  @Min(1)
  @Max(65_535)
  @Type(() => Number)
  readonly port!: number;

  @IsBoolean()
  @TransformStringToBoolean()
  readonly useTls!: boolean;

  @IsString()
  @IsOptional()
  readonly username?: string;

  @IsString()
  @IsNotEmpty()
  @ValidateIf((config: ValkeyConfigSchema) => config.username !== undefined || config.password !== undefined)
  readonly password?: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  readonly connectTimeoutMs!: number;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  readonly requestTimeoutMs!: number;
}
