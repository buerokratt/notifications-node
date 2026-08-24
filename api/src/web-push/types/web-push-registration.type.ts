import type { PushSubscription } from 'web-push';

import type { WebPushRecipientTarget } from './web-push-recipient-target.type';

export type WebPushRegistration = {
  readonly targets: readonly WebPushRecipientTarget[];
  readonly subscription: PushSubscription;
  readonly expirationTimeSeconds: number;
};
