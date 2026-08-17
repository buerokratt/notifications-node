import type { NotificationClientError } from '../errors/index.js';
import type { NotificationsConnectionStatus } from '../types/index.js';

export interface NotificationsConnectionState {
  readonly error?: NotificationClientError;
  readonly status: NotificationsConnectionStatus;
}
