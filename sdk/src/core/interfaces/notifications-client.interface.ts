import type { NotificationsConnectionStateListener } from '../types/index.js';
import type { WebPushEnableResult } from '../types/web-push-enable-result.type.js';
import type { NotificationEvent } from './notification-event.interface.js';
import type { NotificationsConnectionState } from './notifications-connection-state.interface.js';

/**
 * Fetch-based notifications client with catch-all event subscriptions.
 */
export interface NotificationsClient {
  /**
   * Requests notification permission and creates or reuses a Web Push subscription.
   */
  readonly enableWebPush: () => Promise<WebPushEnableResult>;

  /**
   * Opens the notification stream, optionally for one or more chats.
   *
   * Replaces an active connection when its chat subscription differs.
   */
  readonly connect: (args?: { readonly chatUuids?: string | readonly string[] }) => void;

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
