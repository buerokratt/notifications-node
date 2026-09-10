import type { NotificationConnectionHttpError } from './notification-connection-http.error.js';
import type { NotificationConnectionLostError } from './notification-connection-lost.error.js';
import type { NotificationEventParseError } from './notification-event-parse.error.js';
import type { NotificationHeartbeatTimeoutError } from './notification-heartbeat-timeout.error.js';
import type { NotificationResponseStreamError } from './notification-response-stream.error.js';

export type NotificationClientError =
  | NotificationConnectionHttpError
  | NotificationConnectionLostError
  | NotificationEventParseError
  | NotificationHeartbeatTimeoutError
  | NotificationResponseStreamError;
