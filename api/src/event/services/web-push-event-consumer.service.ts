import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { NotificationRecipient } from '../../rabbitmq/enums';
import { RabbitmqService } from '../../rabbitmq/services';
import type { RabbitmqNotificationEvent } from '../../rabbitmq/types';
import { WebPushService } from '../../web-push/services/web-push.service';
import type { WebPushRecipientTarget } from '../../web-push/types';

@Injectable()
export class WebPushEventConsumerService implements OnApplicationBootstrap {
  constructor(
    private readonly rabbitmqService: RabbitmqService,
    private readonly webPushService: WebPushService,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    await this.rabbitmqService.subscribeWebPush((event) => this.handle(event));
  }

  private async handle(event: RabbitmqNotificationEvent): Promise<void> {
    if (!event.webPush) return;

    const target = this.getTarget(event);
    if (!target) return;

    await this.webPushService.deliver({
      body: event.webPush.body,
      eventUuid: event.eventUuid,
      target,
      title: event.webPush.title,
      ttl: event.webPush.ttl,
    });
  }

  private getTarget(event: RabbitmqNotificationEvent): WebPushRecipientTarget | undefined {
    if (event.recipient === NotificationRecipient.Global) {
      return { recipient: NotificationRecipient.Global };
    }

    if (event.recipientUuid) {
      return {
        recipient: event.recipient,
        recipientUuid: event.recipientUuid,
      };
    }
  }
}
