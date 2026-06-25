import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiOperation } from '@nestjs/swagger';

import { CreateNotificationEventBodyDto } from '../../notification/dtos';
import { NotificationService } from '../../notification/services';

@Controller({ version: '1', path: '/notifications' })
export class PrivateNotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('/events')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Publish a notification event' })
  @ApiAcceptedResponse({
    description: 'Notification event was accepted by RabbitMQ',
  })
  @ApiBadRequestResponse({
    description: 'Invalid notification event envelope',
  })
  public async publishNotificationEvent(@Body() body: CreateNotificationEventBodyDto): Promise<void> {
    await this.notificationService.publishNotificationEvent(body);
  }
}
