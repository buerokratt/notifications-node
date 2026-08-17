export class NotificationResponseStreamError extends Error {
  readonly name = 'NotificationResponseStreamError';

  constructor() {
    super('Notification response does not contain a readable stream');
  }
}
