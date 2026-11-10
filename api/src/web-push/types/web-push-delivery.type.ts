import type { WebPushRecipientTarget } from './web-push-recipient-target.type';

export type WebPushDelivery = {
  readonly event: {
    readonly type: string;
    readonly uuid: string;
  };
  readonly target: WebPushRecipientTarget;
  readonly title: string;
  readonly body: string;
  readonly ttl?: number;
};
