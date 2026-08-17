export type WebPushEnableResult =
  | {
      readonly status: 'enabled';
      readonly subscription: PushSubscription;
    }
  | { readonly status: 'denied' }
  | { readonly status: 'unsupported' };
