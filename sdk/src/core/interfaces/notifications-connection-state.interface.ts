import type { NotificationsConnectionStatus } from '../types/index.js';

export interface NotificationsConnectionState {
  readonly error?: Error;
  readonly status: NotificationsConnectionStatus;
}
