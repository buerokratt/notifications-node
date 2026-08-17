import { describe, expectTypeOf, it } from 'vitest';

import type { NotificationData, NotificationHeartbeatData, NotificationsClient } from '../src/core/index.js';
import { useNotificationsClient } from '../src/react.js';

type PublicReactClient = ReturnType<typeof useNotificationsClient>;

describe('public React client type', () => {
  it('includes reconnect and state subscription while excluding raw event subscriptions', () => {
    expectTypeOf<PublicReactClient['reconnect']>().toEqualTypeOf<NotificationsClient['reconnect']>();
    expectTypeOf<PublicReactClient['subscribeToState']>().toEqualTypeOf<NotificationsClient['subscribeToState']>();
    expectTypeOf<'subscribeToEvent' extends keyof PublicReactClient ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'subscribeToEvents' extends keyof PublicReactClient ? true : false>().toEqualTypeOf<false>();
  });

  it('allows connections without chats', () => {
    expectTypeOf<NotificationsClient['connect']>().toBeCallableWith();
    expectTypeOf<NotificationsClient['connect']>().toBeCallableWith({});
  });

  it('exposes user notification and heartbeat data contracts', () => {
    type UserNotificationData = Extract<NotificationData, { readonly recipient: 'USER' }>;

    expectTypeOf<UserNotificationData['recipientUuid']>().toEqualTypeOf<string>();
    expectTypeOf<NotificationHeartbeatData>().toEqualTypeOf<{ readonly heartbeatIntervalMs: number }>();
  });
});
