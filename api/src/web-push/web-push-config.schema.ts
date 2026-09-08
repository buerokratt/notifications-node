import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';

export class WebPushConfigSchema {
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:https:\/\/|mailto:)/)
  readonly vapidSubject!: string;

  @IsString()
  @IsNotEmpty()
  readonly vapidPublicKey!: string;

  @IsString()
  @IsNotEmpty()
  readonly vapidPrivateKey!: string;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  readonly defaultTtlSeconds!: number;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  readonly requestTimeoutMs!: number;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  readonly concurrency!: number;
}
