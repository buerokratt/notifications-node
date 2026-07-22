import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

import { NotificationRecipient } from '../../rabbitmq/enums';
import { IsNotReservedNotificationEventType, IsValidNotificationRecipientUuid } from '../validators';
import { NotificationEventWebPushDto } from './notification-event-web-push.dto';

export class CreateNotificationEventBodyDto {
  @IsDefined()
  @IsUUID('4')
  @ApiProperty({
    description: 'The UUID of the notification event',
    format: 'uuid',
    example: 'b0e97ac6-47ef-4bbf-83a6-cf01ebae5f3d',
  })
  readonly eventUuid!: string;

  @IsValidNotificationRecipientUuid(['CHAT'])
  @ApiPropertyOptional({
    description: 'The UUID of the recipient chat. Required for CHAT events and omitted for GLOBAL events.',
    format: 'uuid',
    example: '6e5ad6e1-570c-4f69-99e6-ab6f28c2f8c5',
  })
  readonly recipientUuid?: string;

  @IsDefined()
  @IsEnum(NotificationRecipient)
  @ApiProperty({
    description: 'The notification recipient',
    enum: NotificationRecipient,
    example: NotificationRecipient.Chat,
  })
  readonly recipient!: NotificationRecipient;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @IsNotReservedNotificationEventType()
  @ApiProperty({
    description: 'The SSE event/ notification type. Reserved types cannot be published through this endpoint.',
    example: 'stream_complete',
  })
  readonly type!: string;

  @IsDefined()
  @IsObject()
  @ApiProperty({
    description: 'Opaque notification payload',
    type: Object,
    example: { isRandomPayload: true },
  })
  readonly payload!: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationEventWebPushDto)
  @ApiPropertyOptional({ type: NotificationEventWebPushDto })
  readonly webPush?: NotificationEventWebPushDto;
}
