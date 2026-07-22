import { BadRequestException, Injectable, Logger, MessageEvent, ServiceUnavailableException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  catchError,
  concat,
  defer,
  EMPTY,
  from,
  ignoreElements,
  interval,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  Subject,
  takeUntil,
} from 'rxjs';
import type { PushSubscription } from 'web-push';

import { NotificationRecipient } from '../../rabbitmq/enums';
import { RabbitmqService } from '../../rabbitmq/services';
import type { RabbitmqNotificationEvent } from '../../rabbitmq/types';
import { NOTIFICATION_RECEIVED_EVENT } from '../../shared/shared.constants';
import { TimService } from '../../tim/services';
import type { TimAuthenticatedRequest } from '../../tim/types';
import { WebPushService } from '../../web-push/services';
import type { WebPushRegistrationHandle } from '../../web-push/types';
import { CreateNotificationEventBodyDto, NotificationEventsQueryDto } from '../dtos';
import {
  SSE_HEARTBEAT_EVENT_TYPE,
  SSE_HEARTBEAT_INTERVAL_MS,
  SSE_SESSION_EXPIRED_EVENT_TYPE,
} from '../notification.constants';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly globalEventStream = new Subject<MessageEvent>();
  private readonly chatEventStreams = new Map<
    string,
    {
      eventStream: Subject<MessageEvent>;
      subscriberCount: number;
    }
  >();

  constructor(
    private readonly rabbitmqService: RabbitmqService,
    private readonly timService: TimService,
    private readonly webPushService: WebPushService,
  ) {}

  public async publishNotificationEvent(body: CreateNotificationEventBodyDto): Promise<void> {
    try {
      await this.rabbitmqService.publishEvent({
        eventUuid: body.eventUuid,
        recipient: body.recipient,
        ...(body.recipient === NotificationRecipient.Chat ? { recipientUuid: body.recipientUuid } : {}),
        type: body.type,
        payload: body.payload,
        ...(body.webPush ? { webPush: body.webPush } : {}),
      });
    } catch (error) {
      this.logger.error('Failed to publish RabbitMQ notification event', error);
      throw new ServiceUnavailableException('RabbitMQ publishing unavailable');
    }
  }

  public async getEventSse(
    query: NotificationEventsQueryDto,
    request: TimAuthenticatedRequest,
    webPushSubscription?: PushSubscription,
  ): Promise<Observable<MessageEvent>> {
    const chatUuids = [...new Set(query.chatUuid)];
    const { decodedToken } = request.timTokenVerificationContext;
    const webPushRegistration = await this.registerWebPushSubscription(
      chatUuids,
      webPushSubscription,
      decodedToken.exp,
    );
    chatUuids.forEach((chatUuid) => this.addChatEventStreamSubscriber(chatUuid));
    await Promise.all(
      chatUuids.map((chatUuid) =>
        this.rabbitmqService.bindChannel({
          recipient: 'CHAT',
          channelId: chatUuid,
        }),
      ),
    );

    return new Observable<MessageEvent>((subscriber) => {
      const closeStream = new Subject<void>();
      const streams = chatUuids
        .map((chatUuid) => this.chatEventStreams.get(chatUuid)?.eventStream)
        .filter((stream): stream is Subject<MessageEvent> => !!stream);

      const subscription = merge(
        this.globalEventStream,
        ...streams,
        this.createHeartbeatStream(),
        this.createTokenRevalidationStream(request, closeStream),
      )
        .pipe(takeUntil(closeStream))
        .subscribe({
          next: (message) => subscriber.next(message),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });

      return () => {
        subscription.unsubscribe();
        closeStream.complete();
        void Promise.all([
          ...(webPushRegistration ? [this.webPushService.unregisterChatConnections(webPushRegistration)] : []),
          ...chatUuids.map((chatUuid) => this.removeChatEventStreamSubscriber(chatUuid)),
        ]).catch((error) => {
          this.logger.error('Failed to clean up disconnected SSE subscriber', error);
        });
      };
    });
  }

  @OnEvent(NOTIFICATION_RECEIVED_EVENT)
  public handleRabbitmqNotificationEvent(event: RabbitmqNotificationEvent): void {
    if (event.webPush) {
      void this.webPushService.deliver({
        eventUuid: event.eventUuid,
        target:
          event.recipient === NotificationRecipient.Global
            ? { type: NotificationRecipient.Global }
            : { type: NotificationRecipient.Chat, chatUuid: event.recipientUuid! },
        title: event.webPush.title,
        body: event.webPush.body,
        ttl: event.webPush.ttl,
      });
    }

    const message: MessageEvent = {
      type: event.type,
      data: {
        eventUuid: event.eventUuid,
        recipient: event.recipient,
        ...(event.recipientUuid ? { recipientUuid: event.recipientUuid } : {}),
        type: event.type,
        payload: event.payload,
      },
    };

    switch (event.recipient) {
      case NotificationRecipient.Global: {
        this.globalEventStream.next(message);
        return;
      }
      case NotificationRecipient.Chat: {
        if (!event.recipientUuid) {
          return this.logger.warn(`Skipping ${event.type} notification event because recipientUuid is missing`);
        }

        const chatEventStreamState = this.chatEventStreams.get(event.recipientUuid);
        if (!chatEventStreamState) return;

        chatEventStreamState.eventStream.next(message);
        return;
      }
      default: {
        this.logger.warn(`Received notification event with unknown recipient: ${event.recipient}`);
        throw new Error(`Unknown notification recipient: ${event.recipient}`);
      }
    }
  }

  private addChatEventStreamSubscriber(chatUuid: string): void {
    const existingState = this.chatEventStreams.get(chatUuid);

    if (existingState) {
      existingState.subscriberCount += 1;
      return;
    }

    this.chatEventStreams.set(chatUuid, {
      eventStream: new Subject<MessageEvent>(),
      subscriberCount: 1,
    });
  }

  private createHeartbeatStream(): Observable<MessageEvent> {
    const createHeartbeat = (): MessageEvent => ({
      type: SSE_HEARTBEAT_EVENT_TYPE,
      data: { heartbeatIntervalMs: SSE_HEARTBEAT_INTERVAL_MS },
    });

    return merge(of(createHeartbeat()), interval(SSE_HEARTBEAT_INTERVAL_MS).pipe(map(createHeartbeat)));
  }

  private async registerWebPushSubscription(
    chatUuids: string[],
    webPushSubscription: PushSubscription | undefined,
    expirationTimeSeconds?: number,
  ): Promise<WebPushRegistrationHandle | undefined> {
    if (!webPushSubscription) return;

    return this.webPushService.registerSubscription(
      chatUuids,
      webPushSubscription,
      this.getTokenExpirationTimeSeconds(expirationTimeSeconds),
    );
  }

  private createTokenRevalidationStream(
    request: TimAuthenticatedRequest,
    closeStream: Subject<void>,
  ): Observable<MessageEvent> {
    return interval(this.timService.tokenRevalidationIntervalMs).pipe(
      mergeMap(() =>
        from(this.timService.verifyToken(request.timTokenVerificationContext)).pipe(
          ignoreElements(),
          catchError(() =>
            concat(
              of({
                type: SSE_SESSION_EXPIRED_EVENT_TYPE,
                data: {},
              }),
              defer(() => {
                closeStream.next();
                return EMPTY;
              }),
            ),
          ),
        ),
      ),
    );
  }

  private async removeChatEventStreamSubscriber(chatUuid: string): Promise<void> {
    const chatEventStreamState = this.chatEventStreams.get(chatUuid);

    if (!chatEventStreamState) return;

    chatEventStreamState.subscriberCount -= 1;

    if (chatEventStreamState.subscriberCount <= 0) {
      chatEventStreamState.eventStream.complete();
      this.chatEventStreams.delete(chatUuid);
      await this.rabbitmqService.unbindChannel({
        recipient: 'CHAT',
        channelId: chatUuid,
      });
    }
  }

  private getTokenExpirationTimeSeconds(expirationTimeSeconds?: number): number {
    if (!expirationTimeSeconds) throw new BadRequestException('JWT does not contain an expiration claim');

    if (expirationTimeSeconds <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('JWT has expired');
    }

    return expirationTimeSeconds;
  }
}
