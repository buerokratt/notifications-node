import { NotificationRecipient } from '../../rabbitmq/enums';

export type WebPushDelivery = {
  readonly eventUuid: string;
  readonly target:
    | {
        readonly type: NotificationRecipient.Global;
      }
    | {
        readonly type: NotificationRecipient.Chat;
        readonly chatUuid: string;
      };
  readonly title: string;
  readonly body: string;
  readonly ttl?: number;
};
