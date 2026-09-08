import { useEffect, useRef } from 'react';

import type { NotificationEvent } from '../../core/index.js';
import type { UseNotificationEventsArgs } from '../interfaces/index.js';
import { useNotificationsClientInternal } from './use-notifications-client-internal.js';

export const useNotificationEvents = <TData = unknown>({
  eventTypes = '*',
  listener,
}: UseNotificationEventsArgs<TData>): void => {
  const { subscribeToEvents } = useNotificationsClientInternal();
  const argsRef = useRef({ eventTypes, listener });

  useEffect(() => {
    argsRef.current = { eventTypes, listener };
  }, [eventTypes, listener]);

  useEffect(
    () =>
      subscribeToEvents((event) => {
        const currentArgs = argsRef.current;

        if (currentArgs.eventTypes !== '*' && !currentArgs.eventTypes.includes(event.type)) return;

        currentArgs.listener(event as NotificationEvent<TData>);
      }),
    [subscribeToEvents],
  );
};
