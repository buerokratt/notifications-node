export class NotificationHeartbeatTimeoutError extends Error {
  readonly name = 'NotificationHeartbeatTimeoutError';

  constructor() {
    super('Notification heartbeat timed out');
  }
}
