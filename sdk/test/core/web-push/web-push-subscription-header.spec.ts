import { describe, expect, it } from 'vitest';

import { encodeWebPushSubscriptionHeader } from '../../../src/core/web-push/web-push-subscription-header.js';

const SUBSCRIPTION_JSON: PushSubscriptionJSON = {
  endpoint: 'https://push.example.test/subscriptions/õ-test',
  expirationTime: null,
  keys: {
    auth: 'auth-secret',
    p256dh: 'public-key',
  },
};

const decodeBase64UrlJson = (value: string): unknown => {
  const base64 = value
    .replace(/-/gu, '+')
    .replace(/_/gu, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
};

describe('encodeWebPushSubscriptionHeader', () => {
  it('encodes the exact subscription JSON as deterministic unpadded Base64URL', () => {
    const subscription = {
      toJSON: () => SUBSCRIPTION_JSON,
    } as PushSubscription;

    const header = encodeWebPushSubscriptionHeader(subscription);

    expect(header).not.toMatch(/[+/=]/u);
    expect(decodeBase64UrlJson(header)).toEqual(SUBSCRIPTION_JSON);
    expect(header).toBe(encodeWebPushSubscriptionHeader(subscription));
  });
});
