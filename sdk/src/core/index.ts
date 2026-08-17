export { createNotificationsClient } from './create-notification-client.js';
export {
  NotificationConnectionHttpError,
  NotificationConnectionLostError,
  NotificationEventParseError,
  NotificationHeartbeatTimeoutError,
  NotificationResponseStreamError,
} from './errors/index.js';
export type { NotificationClientError } from './errors/index.js';

export type {
  NotificationEvent,
  NotificationsClient,
  NotificationsClientConfig,
  NotificationsConnectionState,
} from './interfaces/index.js';
export type {
  NotificationData,
  NotificationHeartbeatData,
  NotificationsConnectionStateListener,
  NotificationsConnectionStatus,
  WebPushEnableResult,
} from './types/index.js';
