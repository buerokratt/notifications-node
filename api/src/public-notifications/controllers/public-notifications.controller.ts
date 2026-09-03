import { Controller, MessageEvent, Query, Req, Sse } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import type { PushSubscription } from 'web-push';

import { NotificationEventsQueryDto } from '../../notification/dtos';
import { NotificationService } from '../../notification/services';
import { TimAuthentication } from '../../tim/guards';
import type { TimAuthenticatedRequest } from '../../tim/types';
import { WebPushSubscriptionHeader } from '../../web-push/decorators';

@Controller({ version: '1', path: '/notifications' })
export class PublicNotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Sse('/events')
  @TimAuthentication()
  @ApiOperation({ summary: 'Subscribe to events' })
  @ApiOkResponse({
    description: 'SSE stream of events',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request parameters or headers',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, rejected, or unverifiable JWT',
  })
  public subscribeToEvents(
    @Query() query: NotificationEventsQueryDto,
    @Req() request: TimAuthenticatedRequest,
    @WebPushSubscriptionHeader() webPushSubscription?: PushSubscription,
  ): Promise<Observable<MessageEvent>> {
    return this.notificationService.getEventSse(query, request, webPushSubscription);
  }
}
