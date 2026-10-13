export class NotificationConnectionHttpError extends Error {
  readonly name = 'NotificationConnectionHttpError';

  constructor(readonly status: number) {
    super(`Notification connection failed with status ${status}`);
  }
}
