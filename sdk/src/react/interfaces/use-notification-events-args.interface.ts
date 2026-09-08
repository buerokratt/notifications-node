import type { NotificationEvent } from '../../core/index.js';

export interface UseNotificationEventsArgs<TData = unknown> {
  readonly eventTypes?: '*' | readonly string[];
  readonly listener: (event: NotificationEvent<TData>) => void;
}
