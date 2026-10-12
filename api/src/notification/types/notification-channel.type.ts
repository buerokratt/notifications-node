import { NotificationRecipient } from '../../rabbitmq/enums';
import type { WebPushRecipientTarget } from '../../web-push/types';

export type ChannelRecipient = Exclude<NotificationRecipient, NotificationRecipient.Global>;
export type ChannelTarget = Extract<WebPushRecipientTarget, { recipient: ChannelRecipient }>;
