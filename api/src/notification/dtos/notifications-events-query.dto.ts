import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class NotificationEventsQueryDto {
  @Transform(({ value }) => (value === undefined || Array.isArray(value) ? value : [value]))
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @IsUUID('4', { each: true })
  @ApiPropertyOptional({
    description: 'The UUID(s) of the chat(s) to subscribe to',
    type: [String],
    format: 'uuid',
    example: ['dee9c8da-2b40-4c6a-a31e-db278b6960b1'],
  })
  readonly chatUuid?: string[];
}
