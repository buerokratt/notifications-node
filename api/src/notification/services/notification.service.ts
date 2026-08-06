import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { interval, map, merge, Observable, of, Subject } from 'rxjs';

import { RabbitmqService } from '../../rabbitmq/services';
import type { RabbitmqNotificationEvent } from '../../rabbitmq/types';
import { NOTIFICATION_RECEIVED_EVENT } from '../../shared/shared.constants';
import { NotificationEventsQueryDto } from '../dtos';
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

  public getEventSse(query: NotificationEventsQueryDto): Observable<MessageEvent> {
    const chatUuids = [...new Set(query.chatUuid)];
    chatUuids.forEach((chatUuid) => this.addChatEventStreamSubscriber(chatUuid));
    void Promise.all(
      chatUuids.map((chatUuid) =>
        this.rabbitmqService.bindChannel({
          target: 'CHAT',
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
        payload: event.payload,
      },
    };

    const chatUuid = event.chatUuid;

    if (!chatUuid) {
      this.globalEventStream.next(message);
      return;
    }

    const chatEventStreamState = this.chatEventStreams.get(chatUuid);
    if (!chatEventStreamState) return;

    chatEventStreamState.eventStream.next(message);
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
        target: 'CHAT',
        channelId: chatUuid,
      });
    }
  }
}
