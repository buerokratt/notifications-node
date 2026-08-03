import { describe, expectTypeOf, it } from 'vitest';

import type { NotificationsClient } from '../src/core/index.js';
import { useNotificationsClient } from '../src/react.js';

type PublicReactClient = ReturnType<typeof useNotificationsClient>;

describe('public React client type', () => {
  it('includes reconnect and state subscription while excluding raw event subscriptions', () => {
    expectTypeOf<PublicReactClient['reconnect']>().toEqualTypeOf<NotificationsClient['reconnect']>();
    expectTypeOf<PublicReactClient['subscribeToState']>().toEqualTypeOf<NotificationsClient['subscribeToState']>();
    expectTypeOf<'subscribeToEvent' extends keyof PublicReactClient ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'subscribeToEvents' extends keyof PublicReactClient ? true : false>().toEqualTypeOf<false>();
  });
});
