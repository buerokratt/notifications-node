import type { WebPushRecipientTarget } from './web-push-recipient-target.type';
import { NotificationRecipient } from '../../rabbitmq/enums';

export type WebPushRegistrationHandle = {
  readonly connectionTargets: readonly Extract<WebPushRecipientTarget, { recipient: NotificationRecipient.Chat }>[];
  readonly connectionId: string;
  readonly subscriptionId: string;
};
