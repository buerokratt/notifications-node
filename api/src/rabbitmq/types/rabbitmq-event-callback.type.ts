import { ConsumeMessage } from 'amqplib';

import { RabbitmqNotificationEvent } from './rabbitmq-notification-event.type';

export type RabbitmqEventCallback = (
  event: RabbitmqNotificationEvent,
  rawMessage: ConsumeMessage,
) => void | Promise<void>;
