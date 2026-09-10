import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDefined, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class NotificationEventWebPushDto {
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ApiProperty({ example: 'New notification' })
  readonly title!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ApiProperty({ example: 'You have a new notification.' })
  readonly body!: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  @ApiPropertyOptional({ description: 'Web Push provider retention time in seconds', minimum: 0 })
  readonly ttl?: number;
}
