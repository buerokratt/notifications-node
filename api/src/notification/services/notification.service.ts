import { randomUUID } from 'node:crypto';

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

import { LifecycleService } from '../../lifecycle/services';
import type { LifecycleConnection } from '../../lifecycle/types';
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

type AuthenticatedUserIdentity = {
  readonly uuid: string;
  readonly idCode: string;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly globalEventStream = new Subject<MessageEvent>();
  private readonly recipientEventStreams = new Map<string, EventStreamState>();

  constructor(
    private readonly lifecycleService: LifecycleService,
    private readonly rabbitmqService: RabbitmqService,
    private readonly timService: TimService,
    private readonly webPushService: WebPushService,
  ) {}

  public async publishNotificationEvent(body: CreateNotificationEventBodyDto): Promise<void> {
    try {
      const event = {
        eventUuid: body.eventUuid,
        recipient: body.recipient,
        type: body.type,
        payload: body.payload,
        ...(body.webPush ? { webPush: body.webPush } : {}),
      };
      const events: RabbitmqNotificationEvent[] =
        body.recipient === NotificationRecipient.Global
          ? [event]
          : (body.recipientUuid ?? []).map((recipientUuid) => ({ ...event, recipientUuid }));

      await this.rabbitmqService.publishEvents(events);
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
    this.validateChatSubscription(request, chatUuids);
    const userIdentity = this.getAuthenticatedUserIdentity(request);
    const userUuid = userIdentity?.uuid;
    const { decodedToken } = request.timTokenVerificationContext;
    const lifecycleConnections = this.getLifecycleConnections(decodedToken.jti, userIdentity);
    const channelTargets: ChannelTarget[] = [
      ...chatUuids.map((recipientUuid) => ({
        recipient: NotificationRecipient.Chat as const,
        recipientUuid,
      })),
      ...(userUuid ? [{ recipient: NotificationRecipient.User as const, recipientUuid: userUuid }] : []),
    ];
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
    await Promise.all(lifecycleConnections.map((connection) => this.registerLifecycleConnection(connection)));

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
        this.createHeartbeatStream(lifecycleConnections),
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
        this.cleanupEventSseConnections(lifecycleConnections, channelTargets, webPushRegistration);
      };
    });
  }

  private cleanupEventSseConnections(
    lifecycleConnections: readonly LifecycleConnection[],
    channelTargets: readonly ChannelTarget[],
    webPushRegistration?: WebPushRegistrationHandle,
  ): void {
    const cleanupTasks = [
      ...lifecycleConnections.map(({ scope, connectionId }) =>
        this.lifecycleService.removeConnection(scope, connectionId),
      ),
      ...channelTargets.map(({ recipient, recipientUuid }) =>
        this.removeRecipientEventStreamSubscriber(recipient, recipientUuid),
      ),
    ];

    if (webPushRegistration) {
      cleanupTasks.push(this.webPushService.unregisterConnectionTargets(webPushRegistration));
    }

    void Promise.all(cleanupTasks).catch((error) => {
      this.logger.error('Failed to clean up disconnected SSE subscriber', error);
    });
  }

  private getLifecycleConnections(jti: string, userIdentity?: AuthenticatedUserIdentity): LifecycleConnection[] {
    if (!userIdentity) return [];

    return [
      {
        scope: { uuid: userIdentity.uuid, type: 'user' },
        connectionId: randomUUID(),
        jti,
        userIdCode: userIdentity.idCode,
      },
    ];
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

  private createHeartbeatStream(connections: readonly LifecycleConnection[]): Observable<MessageEvent> {
    const createHeartbeat = (): MessageEvent => ({
      type: SSE_HEARTBEAT_EVENT_TYPE,
      data: { heartbeatIntervalMs: SSE_HEARTBEAT_INTERVAL_MS },
    });

    const heartbeatStream = merge(
      of(createHeartbeat()),
      interval(SSE_HEARTBEAT_INTERVAL_MS).pipe(map(createHeartbeat)),
    );
    if (connections.length === 0) return heartbeatStream;

    return heartbeatStream.pipe(
      mergeMap((heartbeat) =>
        from(Promise.all(connections.map((connection) => this.registerLifecycleConnection(connection)))).pipe(
          map(() => heartbeat),
        ),
      ),
    );
  }

  private registerLifecycleConnection(connection: LifecycleConnection): Promise<void> {
    return this.lifecycleService.registerConnection(
      connection.scope,
      connection.connectionId,
      connection.jti,
      connection.userIdCode,
    );
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

  private validateChatSubscription(request: TimAuthenticatedRequest, chatUuids: readonly string[]): void {
    const { cookieName, decodedToken } = request.timTokenVerificationContext;
    if (cookieName !== 'chatJwt') return;

    const chatUuid = decodedToken['chatId'];
    if (typeof chatUuid !== 'string' || chatUuids.length !== 1 || chatUuids[0] !== chatUuid) {
      throw new UnauthorizedException();
    }
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

  private getAuthenticatedUserIdentity(request: TimAuthenticatedRequest): AuthenticatedUserIdentity | undefined {
    const { cookieName, decodedToken } = request.timTokenVerificationContext;
    if (cookieName !== TIM_USER_IDENTITY_COOKIE_NAME) return;

    try {
      const idCode = decodedToken.idCode;
      if (typeof idCode !== 'string') throw new Error('Invalid user id code');

      return { idCode, uuid: UserRecipientUuidUtil.normalizeIdCode(idCode) };
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
