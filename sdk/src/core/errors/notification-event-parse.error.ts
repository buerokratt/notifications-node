export class NotificationEventParseError extends Error {
  readonly name = 'NotificationEventParseError';

  constructor(readonly cause?: unknown) {
    super('Failed to parse notification event data');
  }
}
