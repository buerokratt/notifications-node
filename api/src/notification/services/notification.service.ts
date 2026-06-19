import {
  Injectable,
  Logger,
  MessageEvent,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { interval, map, merge, Observable, of, Subject } from 'rxjs';

import { NotificationRecipient } from '../../rabbitmq/enums';
import { RabbitmqService } from '../../rabbitmq/services';
import type { RabbitmqNotificationEvent } from '../../rabbitmq/types';
import { NOTIFICATION_RECEIVED_EVENT } from '../../shared/shared.constants';
import { CreateNotificationEventBodyDto, NotificationEventsQueryDto } from '../dtos';
import { SSE_HEARTBEAT_EVENT_TYPE, SSE_HEARTBEAT_INTERVAL_MS } from '../notification.constants';

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

  constructor(private readonly rabbitmqService: RabbitmqService) {}

  public async publishNotificationEvent(
    body: CreateNotificationEventBodyDto,
  ): Promise<void> {
    try {
      await this.rabbitmqService.publishEvent({
        eventUuid: body.eventUuid,
        recipient: body.recipient,
        ...(body.recipient === NotificationRecipient.Chat
          ? { recipientUuid: body.recipientUuid }
          : {}),
        type: body.type,
        payload: body.payload,
      });
    } catch (error) {
      this.logger.error('Failed to publish RabbitMQ notification event', error);
      throw new ServiceUnavailableException('RabbitMQ publishing unavailable');
    }
  }

  public getEventSse(query: NotificationEventsQueryDto): Observable<MessageEvent> {
    const chatUuids = [...new Set(query.chatUuid)];
    chatUuids.forEach((chatUuid) => this.addChatEventStreamSubscriber(chatUuid));
    void Promise.all(
      chatUuids.map((chatUuid) =>
        this.rabbitmqService.bindChannel({
          recipient: 'CHAT',
          channelId: chatUuid,
        }),
      ),
    ).catch((error) => {
      this.logger.error('Failed to bind RabbitMQ chat channels', error);
    });

    return new Observable<MessageEvent>((subscriber) => {
      const streams = chatUuids
        .map((chatUuid) => this.chatEventStreams.get(chatUuid)?.eventStream)
        .filter((stream): stream is Subject<MessageEvent> => !!stream);

      const subscription = merge(this.globalEventStream, ...streams, this.createHeartbeatStream()).subscribe({
        next: (message) => subscriber.next(message),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });

      return () => {
        subscription.unsubscribe();
        void Promise.all(chatUuids.map((chatUuid) => this.removeChatEventStreamSubscriber(chatUuid))).catch((error) => {
          this.logger.error('Failed to remove chat SSE subscribers', error);
        });
      };
    });
  }

  @OnEvent(NOTIFICATION_RECEIVED_EVENT)
  public handleRabbitmqNotificationEvent(event: RabbitmqNotificationEvent): void {
    this.logger.log('Received event:', event);

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
          return this.logger.warn(
            `Skipping ${event.type} notification event because recipientUuid is missing`,
          );
        }

        const chatEventStreamState = this.chatEventStreams.get(
          event.recipientUuid,
        );
        if (!chatEventStreamState) return;

        chatEventStreamState.eventStream.next(message);
        return;
      }
      default: {
        this.logger.warn(
          `Received notification event with unknown recipient: ${event.recipient}`,
        );
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
      data: {},
    });

    return merge(of(createHeartbeat()), interval(SSE_HEARTBEAT_INTERVAL_MS).pipe(map(createHeartbeat)));
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
}
