import { useEffect, useRef } from 'react';

import type { NotificationEvent } from '../../core/index.js';
import { useNotificationsClientInternal } from './use-notifications-client-internal.js';

export const useNotificationEvent = <TData = unknown>(
  eventType: string,
  listener: (event: NotificationEvent<TData>) => void,
): void => {
  const { subscribeToEvent } = useNotificationsClientInternal();
  const listenerRef = useRef(listener);

  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  useEffect(
    () =>
      subscribeToEvent<TData>(eventType, (event) => {
        listenerRef.current(event);
      }),
    [eventType, subscribeToEvent],
  );
};
