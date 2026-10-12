import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationEvent, NotificationsClient } from '../../src/core/index.js';
import { useNotificationEvent } from '../../src/react/hooks/use-notification-event.js';
import { NotificationsProvider } from '../../src/react/providers/notifications-provider.js';
import { createNotificationsClientStub } from '../helpers/notifications-client.helper.js';

interface HookProps {
  readonly eventType: string;
  readonly listener: (event: NotificationEvent<{ readonly id: string }>) => void;
}

const event = (id: string, type = 'notice'): NotificationEvent<{ readonly id: string }> => ({
  data: { id },
  type,
});

describe('useNotificationEvent', () => {
  it('delivers named events through the latest callback without unnecessary resubscription', () => {
    let activeListener: ((event: NotificationEvent<{ readonly id: string }>) => void) | undefined;
    let subscriptionCount = 0;
    let cleanupCount = 0;
    const subscribeToEvent: NotificationsClient['subscribeToEvent'] = <TData,>(
      eventType: string,
      listener: (value: NotificationEvent<TData>) => void,
    ) => {
      expect(eventType).toBe('notice');
      subscriptionCount += 1;
      activeListener = listener as (value: NotificationEvent<{ readonly id: string }>) => void;
      return () => {
        cleanupCount += 1;
        activeListener = undefined;
      };
    };
    const client = createNotificationsClientStub({ subscribeToEvent });
    const wrapper = ({ children }: PropsWithChildren) => (
      <NotificationsProvider client={client}>{children}</NotificationsProvider>
    );
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ eventType, listener }: HookProps) => useNotificationEvent(eventType, listener),
      { initialProps: { eventType: 'notice', listener: firstListener }, wrapper },
    );

    activeListener?.(event('first'));
    rerender({ eventType: 'notice', listener: secondListener });
    activeListener?.(event('second'));

    expect(subscriptionCount).toBe(1);
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).toHaveBeenCalledWith(event('second'));

    unmount();
    expect(cleanupCount).toBe(1);
    expect(activeListener).toBeUndefined();
  });

  it('cleans up and subscribes to the new name when the event type changes', () => {
    const eventTypes: string[] = [];
    let activeSubscriptions = 0;
    const subscribeToEvent: NotificationsClient['subscribeToEvent'] = (eventType) => {
      eventTypes.push(eventType);
      activeSubscriptions += 1;
      return () => {
        activeSubscriptions -= 1;
      };
    };
    const client = createNotificationsClientStub({ subscribeToEvent });
    const wrapper = ({ children }: PropsWithChildren) => (
      <NotificationsProvider client={client}>{children}</NotificationsProvider>
    );
    const { rerender, unmount } = renderHook(
      ({ eventType }: { readonly eventType: string }) => useNotificationEvent(eventType, () => undefined),
      { initialProps: { eventType: 'first' }, wrapper },
    );

    rerender({ eventType: 'second' });

    expect(eventTypes).toEqual(['first', 'second']);
    expect(activeSubscriptions).toBe(1);
    unmount();
    expect(activeSubscriptions).toBe(0);
  });

  it('leaves exactly one active subscription in React Strict Mode', () => {
    let activeSubscriptions = 0;
    const subscribeToEvent: NotificationsClient['subscribeToEvent'] = () => {
      activeSubscriptions += 1;
      return () => {
        activeSubscriptions -= 1;
      };
    };
    const client = createNotificationsClientStub({ subscribeToEvent });
    const wrapper = ({ children }: PropsWithChildren) => (
      <StrictMode>
        <NotificationsProvider client={client}>{children}</NotificationsProvider>
      </StrictMode>
    );

    const { unmount } = renderHook(() => useNotificationEvent('notice', () => undefined), { wrapper });

    expect(activeSubscriptions).toBe(1);
    unmount();
    expect(activeSubscriptions).toBe(0);
  });
});
