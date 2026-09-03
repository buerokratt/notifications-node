import { NotificationRecipient } from '../../rabbitmq/enums';

export type WebPushRecipientTarget =
  | {
      readonly recipient: NotificationRecipient.Global;
    }
  | {
      readonly recipient: NotificationRecipient.Chat;
      readonly recipientUuid: string;
    }
  | {
      readonly recipient: NotificationRecipient.User;
      readonly recipientUuid: string;
    };

export type WebPushChatTarget = Extract<WebPushRecipientTarget, { recipient: NotificationRecipient.Chat }>;
export type WebPushUserTarget = Extract<WebPushRecipientTarget, { recipient: NotificationRecipient.User }>;
