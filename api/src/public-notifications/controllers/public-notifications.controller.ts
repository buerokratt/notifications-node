import { Controller, MessageEvent, Query, Sse } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { Observable } from 'rxjs';

import { NotificationEventsQueryDto } from '../../notification/dtos';
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
}
