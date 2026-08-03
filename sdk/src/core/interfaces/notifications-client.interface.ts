import type { NotificationsConnectionStateListener } from '../types/index.js';
import type { NotificationEvent } from './notification-event.interface.js';
import type { NotificationsConnectionState } from './notifications-connection-state.interface.js';

/**
 * Fetch-based notifications client with catch-all event subscriptions.
 */
export interface NotificationsClient {
  /**
   * Opens the notification stream for one or more chats.
   *
   * Replaces an active connection when its chat subscription differs.
   */
  readonly connect: (args: { readonly chatUuids: string | string[] }) => void;

  /**
   * Closes the active notification stream.
   */
  readonly disconnect: () => void;

  /**
   * Replaces the active notification stream using the chats from the latest
   * connect call and the browser's current credentials.
   */
  readonly reconnect: () => void;

  /**
   * Returns the current immutable connection-state snapshot.
   */
  readonly getState: () => NotificationsConnectionState;

  /**
   * Registers a connection-state listener.
   */
  readonly subscribeToState: (listener: NotificationsConnectionStateListener) => () => void;

  /**
   * Registers a listener for a named notification event.
   */
  readonly subscribeToEvent: <TData = unknown>(
    eventType: string,
    listener: (event: NotificationEvent<TData>) => void,
  ) => () => void;

  /**
   * Registers a listener for every notification event.
   */
  readonly subscribeToEvents: (listener: (event: NotificationEvent<unknown>) => void) => () => void;
}
