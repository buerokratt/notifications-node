export type RabbitmqNotificationEvent = {
  readonly eventId: string;
  readonly chatUuid?: string;
  readonly channelId?: string;
  readonly type: string;
  readonly payload: unknown;
};
