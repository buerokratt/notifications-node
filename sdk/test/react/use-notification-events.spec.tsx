import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationEvent, NotificationsClient } from '../../src/core/index.js';
import { useNotificationEvents } from '../../src/react/hooks/use-notification-events.js';
import { NotificationsProvider } from '../../src/react/providers/notifications-provider.js';
import { createNotificationsClientStub } from '../helpers/notifications-client.helper.js';

interface HookProps {
  readonly eventTypes?: '*' | readonly string[];
  readonly listener: (event: NotificationEvent<unknown>) => void;
}

const event = (type: string): NotificationEvent<{ readonly id: string }> => ({
  data: { id: type },
  type,
});

describe('useNotificationEvents', () => {
  it('uses the latest callback and filter without resubscribing to the catch-all stream', () => {
    let activeListener: ((event: NotificationEvent<unknown>) => void) | undefined;
    let subscriptionCount = 0;
    let cleanupCount = 0;
    const subscribeToEvents: NotificationsClient['subscribeToEvents'] = (listener) => {
      subscriptionCount += 1;
      activeListener = listener;
      return () => {
        cleanupCount += 1;
        activeListener = undefined;
      };
    };
    const client = createNotificationsClientStub({ subscribeToEvents });
    const wrapper = ({ children }: PropsWithChildren) => (
      <NotificationsProvider client={client}>{children}</NotificationsProvider>
    );
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ eventTypes, listener }: HookProps) => useNotificationEvents({ eventTypes, listener }),
      { initialProps: { eventTypes: ['first'], listener: firstListener }, wrapper },
    );

    activeListener?.(event('first'));
    activeListener?.(event('ignored'));
    rerender({ eventTypes: ['second'], listener: secondListener });
    activeListener?.(event('first'));
    activeListener?.(event('second'));

    expect(subscriptionCount).toBe(1);
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).toHaveBeenCalledOnce();
    expect(secondListener).toHaveBeenCalledWith(event('second'));

    unmount();
    expect(cleanupCount).toBe(1);
  });

  it('defaults to delivering every event type', () => {
    let activeListener: ((event: NotificationEvent<unknown>) => void) | undefined;
    const subscribeToEvents: NotificationsClient['subscribeToEvents'] = (listener) => {
      activeListener = listener;
      return () => {
        activeListener = undefined;
      };
    };
    const client = createNotificationsClientStub({ subscribeToEvents });
    const wrapper = ({ children }: PropsWithChildren) => (
      <NotificationsProvider client={client}>{children}</NotificationsProvider>
    );
    const listener = vi.fn();
    renderHook(() => useNotificationEvents({ listener }), { wrapper });

    activeListener?.(event('first'));
    activeListener?.(event('second'));

    expect(listener.mock.calls).toEqual([[event('first')], [event('second')]]);
  });

  it('leaves exactly one catch-all subscription in React Strict Mode and cleans it up', () => {
    let activeSubscriptions = 0;
    const subscribeToEvents: NotificationsClient['subscribeToEvents'] = () => {
      activeSubscriptions += 1;
      return () => {
        activeSubscriptions -= 1;
      };
    };
    const client = createNotificationsClientStub({ subscribeToEvents });
    const wrapper = ({ children }: PropsWithChildren) => (
      <StrictMode>
        <NotificationsProvider client={client}>{children}</NotificationsProvider>
      </StrictMode>
    );

    const { unmount } = renderHook(() => useNotificationEvents({ listener: () => undefined }), { wrapper });

    expect(activeSubscriptions).toBe(1);
    unmount();
    expect(activeSubscriptions).toBe(0);
  });
});
