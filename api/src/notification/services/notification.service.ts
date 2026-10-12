import {
  BadRequestException,
  Injectable,
  Logger,
  MessageEvent,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
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
import { TIM_USER_IDENTITY_COOKIE_NAME } from '../../tim/tim.constants';
import type { TimAuthenticatedRequest } from '../../tim/types';
import { WebPushService } from '../../web-push/services';
import type { WebPushRegistrationHandle } from '../../web-push/types';
import { CreateNotificationEventBodyDto, NotificationEventsQueryDto } from '../dtos';
import {
  SSE_HEARTBEAT_EVENT_TYPE,
  SSE_HEARTBEAT_INTERVAL_MS,
  SSE_SESSION_EXPIRED_EVENT_TYPE,
} from '../notification.constants';
import type { ChannelRecipient, ChannelTarget, EventStreamState } from '../types';
import { UserRecipientUuidUtil } from '../utils';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly globalEventStream = new Subject<MessageEvent>();
  private readonly recipientEventStreams = new Map<string, EventStreamState>();

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
        ...(body.recipientUuid ? { recipientUuid: body.recipientUuid } : {}),
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
    const chatUuids = [...new Set(query.chatUuid ?? [])];
    const userUuid = this.getAuthenticatedUserUuid(request);
    const channelTargets: ChannelTarget[] = [
      ...chatUuids.map((recipientUuid) => ({
        recipient: NotificationRecipient.Chat as const,
        recipientUuid,
      })),
      ...(userUuid ? [{ recipient: NotificationRecipient.User as const, recipientUuid: userUuid }] : []),
    ];
    const { decodedToken } = request.timTokenVerificationContext;
    const webPushRegistration = await this.registerWebPushSubscription(
      channelTargets,
      webPushSubscription,
      decodedToken.exp,
    );
    channelTargets.forEach(({ recipient, recipientUuid }) =>
      this.addRecipientEventStreamSubscriber(recipient, recipientUuid),
    );
    await Promise.all(
      channelTargets.map(({ recipient, recipientUuid }) =>
        this.rabbitmqService.bindChannel({
          recipient,
          channelId: recipientUuid,
        }),
      ),
    );

    return new Observable<MessageEvent>((subscriber) => {
      const closeStream = new Subject<void>();
      const streams = channelTargets
        .map(
          ({ recipient, recipientUuid }) =>
            this.recipientEventStreams.get(this.recipientStreamKey(recipient, recipientUuid))?.eventStream,
        )
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
          ...(webPushRegistration ? [this.webPushService.unregisterConnectionTargets(webPushRegistration)] : []),
          ...channelTargets.map(({ recipient, recipientUuid }) =>
            this.removeRecipientEventStreamSubscriber(recipient, recipientUuid),
          ),
        ]).catch((error) => {
          this.logger.error('Failed to clean up disconnected SSE subscriber', error);
        });
      };
    });
  }

  @OnEvent(NOTIFICATION_RECEIVED_EVENT)
  public handleRabbitmqNotificationEvent(event: RabbitmqNotificationEvent): void {
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
      case NotificationRecipient.Chat:
      case NotificationRecipient.User: {
        if (!event.recipientUuid) {
          return this.logger.warn(`Skipping ${event.type} notification event because recipientUuid is missing`);
        }

        const eventStreamState = this.recipientEventStreams.get(
          this.recipientStreamKey(event.recipient, event.recipientUuid),
        );
        eventStreamState?.eventStream.next(message);
        return;
      }
      default: {
        this.logger.warn(`Received notification event with unknown recipient: ${event.recipient}`);
        throw new Error(`Unknown notification recipient: ${event.recipient}`);
      }
    }
  }

  private addRecipientEventStreamSubscriber(recipient: ChannelRecipient, recipientUuid: string): void {
    const streamKey = this.recipientStreamKey(recipient, recipientUuid);
    const existingState = this.recipientEventStreams.get(streamKey);

    if (existingState) {
      existingState.subscriberCount += 1;
      return;
    }

    this.recipientEventStreams.set(streamKey, {
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
    channelTargets: readonly ChannelTarget[],
    webPushSubscription: PushSubscription | undefined,
    expirationTimeSeconds?: number,
  ): Promise<WebPushRegistrationHandle | undefined> {
    if (!webPushSubscription) return;

    return this.webPushService.registerSubscription({
      targets: [{ recipient: NotificationRecipient.Global }, ...channelTargets],
      subscription: webPushSubscription,
      expirationTimeSeconds: this.getTokenExpirationTimeSeconds(expirationTimeSeconds),
    });
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

  private async removeRecipientEventStreamSubscriber(
    recipient: ChannelRecipient,
    recipientUuid: string,
  ): Promise<void> {
    const streamKey = this.recipientStreamKey(recipient, recipientUuid);
    const eventStreamState = this.recipientEventStreams.get(streamKey);

    if (!eventStreamState) return;

    eventStreamState.subscriberCount -= 1;

    if (eventStreamState.subscriberCount <= 0) {
      eventStreamState.eventStream.complete();
      this.recipientEventStreams.delete(streamKey);
      await this.rabbitmqService.unbindChannel({
        recipient,
        channelId: recipientUuid,
      });
    }
  }

  private getAuthenticatedUserUuid(request: TimAuthenticatedRequest): string | undefined {
    const { cookieName, decodedToken } = request.timTokenVerificationContext;
    if (cookieName !== TIM_USER_IDENTITY_COOKIE_NAME) return;

    try {
      return UserRecipientUuidUtil.normalizeIdCode(decodedToken.idCode);
    } catch {
      throw new UnauthorizedException();
    }
  }

  private recipientStreamKey(recipient: ChannelRecipient, recipientUuid: string): string {
    return `${recipient}:${recipientUuid}`;
  }

  private getTokenExpirationTimeSeconds(expirationTimeSeconds?: number): number {
    if (!expirationTimeSeconds) throw new BadRequestException('JWT does not contain an expiration claim');

    if (expirationTimeSeconds <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('JWT has expired');
    }

    return expirationTimeSeconds;
  }
}
