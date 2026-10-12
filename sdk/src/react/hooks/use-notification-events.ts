import { useEffect, useRef } from 'react';

import type { UseNotificationEventsArgs } from '../interfaces/index.js';
import { useNotificationsClientInternal } from './use-notifications-client-internal.js';

export const useNotificationEvents = ({ eventTypes = '*', listener }: UseNotificationEventsArgs): void => {
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

        currentArgs.listener(event);
      }),
    [subscribeToEvents],
  );
};
