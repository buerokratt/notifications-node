import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { useNotificationEvent } from '../../src/react/hooks/use-notification-event.js';
import { useNotificationEvents } from '../../src/react/hooks/use-notification-events.js';
import { useNotificationsClient } from '../../src/react/hooks/use-notifications-client.js';
import { NotificationsProvider } from '../../src/react/providers/notifications-provider.js';
import { createNotificationsClientStub } from '../helpers/notifications-client.helper.js';

describe('NotificationsProvider', () => {
  it('supplies its client to notification hooks', () => {
    const client = createNotificationsClientStub();
    const wrapper = ({ children }: PropsWithChildren) => (
      <NotificationsProvider client={client}>{children}</NotificationsProvider>
    );

    const { result } = renderHook(() => useNotificationsClient(), { wrapper });

    expect(result.current).toBe(client);
  });

  it.each([
    ['client', () => useNotificationsClient()],
    ['named event', () => useNotificationEvent('notice', () => undefined)],
    ['catch-all events', () => useNotificationEvents({ listener: () => undefined })],
  ])('rejects the %s hook outside the provider', (name, useHook) => {
    void name;
    expect(() => renderHook(useHook)).toThrow('Notifications hooks must be used within NotificationsProvider');
  });
});
