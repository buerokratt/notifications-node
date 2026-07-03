import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiOperation, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { CreateNotificationEventBodyDto } from '../../notification/dtos';
import { NotificationService } from '../../notification/services';
import { TimAuthentication } from '../../tim/guards';

@Controller({ version: '1', path: '/notifications' })
export class PrivateNotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('/events')
  @TimAuthentication()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Publish a notification event' })
  @ApiAcceptedResponse({
    description: 'Notification event was accepted by RabbitMQ',
  })
  @ApiBadRequestResponse({
    description: 'Invalid notification event envelope',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, rejected, or unverifiable JWT',
  })
  public async publishNotificationEvent(@Body() body: CreateNotificationEventBodyDto): Promise<void> {
    await this.notificationService.publishNotificationEvent(body);
  }
}
