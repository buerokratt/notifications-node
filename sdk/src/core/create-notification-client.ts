import { createParser, type EventSourceMessage } from 'eventsource-parser';

import {
  NOTIFICATIONS_ENDPOINT_PATH,
  NOTIFICATIONS_HEARTBEAT_EVENT_TYPE,
  NOTIFICATIONS_HEARTBEAT_TIMEOUT_MS,
  NOTIFICATIONS_SESSION_EXPIRED_EVENT_TYPE,
} from './core.constants.js';
import type {
  NotificationEvent,
  NotificationsClient,
  NotificationsClientConfig,
  NotificationsConnectionState,
} from './interfaces/index.js';
import type { NotificationsConnectionStateListener } from './types/index.js';

const DEFAULT_RECONNECT_DELAY_MS = 3_000;

const assertNonEmptyString = (value: string, name: keyof NotificationsClientConfig): void => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
};

const assertApiBaseUrl = (apiBaseUrl: string): void => {
  assertNonEmptyString(apiBaseUrl, 'apiBaseUrl');

  if (apiBaseUrl.endsWith('/')) {
    throw new TypeError('apiBaseUrl must not end with "/"');
  }
};

const getChatUuids = (chatUuids: string | string[]): readonly string[] =>
  [...new Set(Array.isArray(chatUuids) ? chatUuids : [chatUuids])].sort();

const getError = (error: unknown, fallbackMessage: string): Error =>
  error instanceof Error ? error : new Error(fallbackMessage);

const wait = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const finishWaiting = (): void => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', finishWaiting);
      resolve();
    };

    const timeoutId = setTimeout(finishWaiting, delayMs);

    signal.addEventListener('abort', finishWaiting, { once: true });
  });

/**
 * Creates a fetch-based notifications client without opening a connection.
 */
export const createNotificationsClient = ({ apiBaseUrl }: NotificationsClientConfig): NotificationsClient => {
  assertApiBaseUrl(apiBaseUrl);

  let connectionAbortController: AbortController | undefined;
  let activeChatUuidsKey: string | undefined;
  let desiredChatUuids: readonly string[] | undefined;
  let desiredChatUuidsKey: string | undefined;
  let state: NotificationsConnectionState = Object.freeze({ status: 'disconnected' });

  const stateListeners = new Set<NotificationsConnectionStateListener>();
  const allEventListeners = new Set<(event: NotificationEvent<unknown>) => void>();
  const eventListeners = new Map<string, Set<(event: NotificationEvent<unknown>) => void>>();

  const getState = (): NotificationsConnectionState => state;

  const setState = (nextState: NotificationsConnectionState): void => {
    if (state.status === nextState.status && state.error === nextState.error) return;

    state = Object.freeze(nextState);
    stateListeners.forEach((listener) => listener());
  };

  const subscribeToState = (listener: NotificationsConnectionStateListener): (() => void) => {
    stateListeners.add(listener);

    return () => {
      stateListeners.delete(listener);
    };
  };

  const subscribeToEvent = <TData = unknown>(
    eventType: string,
    listener: (event: NotificationEvent<TData>) => void,
  ): (() => void) => {
    const listeners = eventListeners.get(eventType) ?? new Set<(event: NotificationEvent<unknown>) => void>();

    eventListeners.set(eventType, listeners);

    const registeredListener = (event: NotificationEvent<unknown>): void => {
      listener(event as NotificationEvent<TData>);
    };

    listeners.add(registeredListener);

    let isSubscribed = true;

    return () => {
      if (!isSubscribed) return;
      isSubscribed = false;

      const registeredListeners = eventListeners.get(eventType);
      registeredListeners?.delete(registeredListener);

      if (!registeredListeners?.size) eventListeners.delete(eventType);
    };
  };

  const subscribeToEvents = (listener: (event: NotificationEvent<unknown>) => void): (() => void) => {
    allEventListeners.add(listener);

    return () => {
      allEventListeners.delete(listener);
    };
  };

  const dispatchEvent = (event: EventSourceMessage): void => {
    const eventType = event.event || 'message';
    let data: unknown;

    try {
      data = JSON.parse(event.data);
    } catch (error) {
      const parsingError = getError(error, 'Failed to parse notification event data');

      setState({ error: parsingError, status: state.status });
      queueMicrotask(() => {
        throw parsingError;
      });
      return;
    }

    const notificationEvent = Object.freeze({ data, type: eventType });
    const listeners = [...allEventListeners, ...(eventListeners.get(eventType) ?? [])];

    listeners.forEach((listener) => {
      try {
        listener(notificationEvent);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    });
  };

  const runConnection = async (url: URL, abortController: AbortController): Promise<void> => {
    const { signal } = abortController;
    let reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS;

    while (!signal.aborted && connectionAbortController === abortController) {
      const requestAbortController = new AbortController();
      let heartbeatTimeoutId: ReturnType<typeof setTimeout> | undefined;
      let heartbeatTimedOut = false;
      let connectionError: Error | undefined;

      const clearHeartbeatTimeout = (): void => {
        if (heartbeatTimeoutId === undefined) return;

        clearTimeout(heartbeatTimeoutId);
        heartbeatTimeoutId = undefined;
      };

      const resetHeartbeatTimeout = (): void => {
        clearHeartbeatTimeout();
        heartbeatTimeoutId = setTimeout(() => {
          heartbeatTimedOut = true;
          requestAbortController.abort();
        }, NOTIFICATIONS_HEARTBEAT_TIMEOUT_MS);
      };

      const abortRequest = (): void => requestAbortController.abort();

      signal.addEventListener('abort', abortRequest, { once: true });

      try {
        const response = await fetch(url, {
          credentials: 'include',
          headers: { Accept: 'text/event-stream' },
          signal: requestAbortController.signal,
        });

        if (response.status === 401) {
          abortController.abort();

          if (connectionAbortController === abortController) {
            setState({ status: 'session-expired' });
          }

          return;
        }

        if (!response.ok) {
          throw new Error(`Notification connection failed with status ${response.status}`);
        }

        if (!response.body) {
          throw new Error('Notification response does not contain a readable stream');
        }

        if (connectionAbortController !== abortController) return;

        setState({ status: 'connected' });
        resetHeartbeatTimeout();

        const parser = createParser({
          onEvent: (event) => {
            if (event.event === NOTIFICATIONS_HEARTBEAT_EVENT_TYPE) resetHeartbeatTimeout();
            dispatchEvent(event);

            if (event.event !== NOTIFICATIONS_SESSION_EXPIRED_EVENT_TYPE) return;

            clearHeartbeatTimeout();
            abortController.abort();

            if (connectionAbortController === abortController) {
              setState({ status: 'session-expired' });
            }
          },
          onRetry: (retryInterval) => (reconnectDelayMs = retryInterval),
        });
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

        while (!requestAbortController.signal.aborted) {
          const { done, value } = await reader.read();

          if (done) break;
          parser.feed(value);
        }

        if (signal.aborted || connectionAbortController !== abortController) return;

        if (heartbeatTimedOut) {
          throw new Error('Notification heartbeat timed out');
        }

        parser.reset({ consume: true });
        throw new Error('Notification connection lost');
      } catch (error) {
        if (signal.aborted || connectionAbortController !== abortController) return;

        connectionError = heartbeatTimedOut
          ? new Error('Notification heartbeat timed out')
          : getError(error, 'Notification connection lost');
      } finally {
        clearHeartbeatTimeout();
        signal.removeEventListener('abort', abortRequest);
        requestAbortController.abort();
      }

      setState({ error: connectionError, status: 'reconnecting' });
      await wait(reconnectDelayMs, signal);
    }
  };

  const closeActiveConnection = (): void => {
    connectionAbortController?.abort();
    connectionAbortController = undefined;
    activeChatUuidsKey = undefined;
  };

  const openConnection = (chatUuids: readonly string[], chatUuidsKey: string): void => {
    const url = new URL(NOTIFICATIONS_ENDPOINT_PATH, apiBaseUrl);

    url.searchParams.delete('chatUuid');
    chatUuids.forEach((chatUuid) => url.searchParams.append('chatUuid', chatUuid));

    closeActiveConnection();
    setState({ status: 'connecting' });

    const abortController = new AbortController();

    connectionAbortController = abortController;
    activeChatUuidsKey = chatUuidsKey;
    void runConnection(url, abortController).finally(() => {
      if (connectionAbortController !== abortController) return;

      connectionAbortController = undefined;
      activeChatUuidsKey = undefined;
    });
  };

  const disconnect = (): void => {
    desiredChatUuids = undefined;
    desiredChatUuidsKey = undefined;
    closeActiveConnection();
    setState({ status: 'disconnected' });
  };

  const connect = ({ chatUuids }: { readonly chatUuids: string | string[] }): void => {
    const normalizedChatUuids = getChatUuids(chatUuids);
    const chatUuidsKey = JSON.stringify(normalizedChatUuids);

    desiredChatUuids = normalizedChatUuids;
    desiredChatUuidsKey = chatUuidsKey;

    if (connectionAbortController && activeChatUuidsKey === chatUuidsKey) return;

    openConnection(normalizedChatUuids, chatUuidsKey);
  };

  const reconnect = (): void => {
    if (!desiredChatUuids || desiredChatUuidsKey === undefined) return;

    openConnection(desiredChatUuids, desiredChatUuidsKey);
  };

  return Object.freeze({
    connect,
    disconnect,
    getState,
    reconnect,
    subscribeToEvent,
    subscribeToEvents,
    subscribeToState,
  });
};
