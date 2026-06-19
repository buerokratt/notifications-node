import { NotificationRecipient } from '../enums';

export type RabbitmqNotificationEvent = {
  readonly eventUuid: string;
  readonly recipient: NotificationRecipient;
  readonly recipientUuid?: string;
  readonly type: string;
  readonly payload: object;
};
