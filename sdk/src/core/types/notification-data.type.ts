export type NotificationData<TPayload = Record<string, unknown>> = {
  readonly eventUuid: string;
  readonly type: string;
  readonly payload: TPayload;
} & (
  | {
      readonly recipient: 'GLOBAL';
    }
  | {
      readonly recipient: 'CHAT';
      readonly recipientUuid: string;
    }
);
