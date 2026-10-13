export class NotificationConnectionLostError extends Error {
  readonly name = 'NotificationConnectionLostError';

  constructor(readonly cause?: unknown) {
    super('Notification connection lost');
  }
}
