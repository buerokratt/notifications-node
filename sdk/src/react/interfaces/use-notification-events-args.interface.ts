import type { NotificationEvent } from '../../core/index.js';

export interface UseNotificationEventsArgs {
  readonly eventTypes?: '*' | readonly string[];
  readonly listener: (event: NotificationEvent<unknown>) => void;
}
