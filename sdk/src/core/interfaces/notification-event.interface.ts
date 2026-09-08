export interface NotificationEvent<TData = unknown> {
  readonly data: TData;
  readonly type: string;
}
