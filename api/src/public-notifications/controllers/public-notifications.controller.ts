import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { Observable } from 'rxjs';

import { CreateNotificationEventBodyDto, NotificationEventsQueryDto } from '../../notification/dtos';
import { NotificationService } from '../../notification/services';

@Controller({ version: '1', path: '/notifications' })
export class PublicNotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Sse('/events')
  @ApiOperation({ summary: 'Subscribe to events' })
  @ApiOkResponse({
    description: 'SSE stream of events',
  })
  @ApiBadRequestResponse({
    description: 'Invalid or missing chatUuid query parameter',
  })
  public subscribeToEvents(@Query() query: NotificationEventsQueryDto): Promise<Observable<MessageEvent>> {
    return this.notificationService.getEventSse(query);
  }

  @Post('/events')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Publish a notification event' })
  @ApiAcceptedResponse({
    description: 'Notification event was accepted by RabbitMQ',
  })
  @ApiBadRequestResponse({
    description: 'Invalid notification event envelope',
  })
  public async publishNotificationEvent(
    @Body() body: CreateNotificationEventBodyDto,
  ): Promise<void> {
    await this.notificationService.publishNotificationEvent(body);
  }
}
