import { createParser, type EventSourceMessage } from 'eventsource-parser';

import {
  DEFAULT_RECONNECT_DELAY_MS,
  HEARTBEAT_TIMEOUT_MULTIPLIER,
  NOTIFICATIONS_ENDPOINT_PATH,
  NOTIFICATIONS_HEARTBEAT_EVENT_TYPE,
  NOTIFICATIONS_SESSION_EXPIRED_EVENT_TYPE,
  WEB_PUSH_SUBSCRIPTION_HEADER,
} from './core.constants.js';
import {
  NotificationConnectionHttpError,
  NotificationConnectionLostError,
  NotificationEventParseError,
  NotificationHeartbeatTimeoutError,
  NotificationResponseStreamError,
  type NotificationClientError,
} from './errors/index.js';
import type {
  NotificationEvent,
  NotificationsClient,
  NotificationsClientConfig,
  NotificationsConnectionState,
} from './interfaces/index.js';
import type {
  NotificationHeartbeatData,
  NotificationsConnectionStateListener,
  WebPushEnableResult,
} from './types/index.js';
import {
  decodeVapidPublicKey,
  enableWebPush as enableBrowserWebPush,
  encodeWebPushSubscriptionHeader,
} from './web-push/index.js';

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

const getChatUuids = (chatUuids: string | readonly string[] | undefined): readonly string[] => {
  if (!chatUuids) return [];
  if (typeof chatUuids === 'string') return [chatUuids];

  return [...new Set(chatUuids)].sort();
};

const getHeartbeatTimeoutMs = (data: unknown): number =>
  (data as NotificationHeartbeatData).heartbeatIntervalMs * HEARTBEAT_TIMEOUT_MULTIPLIER;

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
export const createNotificationsClient = ({
  apiBaseUrl,
  vapidPublicKey,
}: NotificationsClientConfig): NotificationsClient => {
  assertApiBaseUrl(apiBaseUrl);
  assertNonEmptyString(vapidPublicKey, 'vapidPublicKey');

  const applicationServerKey = decodeVapidPublicKey(vapidPublicKey);

  let connectionAbortController: AbortController | undefined;
  let activeChatUuidsKey: string | undefined;
  let desiredChatUuids: readonly string[] | undefined;
  let desiredChatUuidsKey: string | undefined;
  let enableWebPushPromise: Promise<WebPushEnableResult> | undefined;
  let state: NotificationsConnectionState = Object.freeze({ status: 'disconnected' });
  let webPushSubscription: PushSubscription | undefined;

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

  const dispatchEvent = (event: EventSourceMessage): NotificationEvent<unknown> | undefined => {
    const eventType = event.event || 'message';
    let data: unknown;

    try {
      data = JSON.parse(event.data);
    } catch (error) {
      const parsingError = new NotificationEventParseError(error);

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

    return notificationEvent;
  };

  const runConnection = async (
    url: URL,
    abortController: AbortController,
    webPushSubscriptionHeader?: string,
  ): Promise<void> => {
    const { signal } = abortController;
    let reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS;

    while (!signal.aborted && connectionAbortController === abortController) {
      const requestAbortController = new AbortController();
      let heartbeatTimeoutId: ReturnType<typeof setTimeout> | undefined;
      let heartbeatTimedOut = false;
      let connectionError: NotificationClientError | undefined;

      const clearHeartbeatTimeout = (): void => {
        if (heartbeatTimeoutId === undefined) return;

        clearTimeout(heartbeatTimeoutId);
        heartbeatTimeoutId = undefined;
      };

      const resetHeartbeatTimeout = (timeoutMs: number): void => {
        clearHeartbeatTimeout();
        heartbeatTimeoutId = setTimeout(() => {
          heartbeatTimedOut = true;
          requestAbortController.abort();
        }, timeoutMs);
      };

      const abortRequest = (): void => requestAbortController.abort();

      signal.addEventListener('abort', abortRequest, { once: true });

      try {
        const response = await fetch(url, {
          credentials: 'include',
          headers: {
            Accept: 'text/event-stream',
            ...(webPushSubscriptionHeader ? { [WEB_PUSH_SUBSCRIPTION_HEADER]: webPushSubscriptionHeader } : {}),
          },
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
          throw new NotificationConnectionHttpError(response.status);
        }

        if (!response.body) {
          throw new NotificationResponseStreamError();
        }

        if (connectionAbortController !== abortController) return;

        setState({ status: 'connected' });

        const parser = createParser({
          onEvent: (event) => {
            const notificationEvent = dispatchEvent(event);

            if (event.event === NOTIFICATIONS_HEARTBEAT_EVENT_TYPE) {
              resetHeartbeatTimeout(getHeartbeatTimeoutMs(notificationEvent?.data));
            }

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
          throw new NotificationHeartbeatTimeoutError();
        }

        parser.reset({ consume: true });
        throw new NotificationConnectionLostError();
      } catch (error) {
        if (signal.aborted || connectionAbortController !== abortController) return;

        const isKnownConnectionError =
          error instanceof NotificationConnectionHttpError ||
          error instanceof NotificationConnectionLostError ||
          error instanceof NotificationHeartbeatTimeoutError ||
          error instanceof NotificationResponseStreamError;

        if (heartbeatTimedOut) {
          connectionError = new NotificationHeartbeatTimeoutError();
        } else if (isKnownConnectionError) {
          connectionError = error;
        } else {
          connectionError = new NotificationConnectionLostError(error);
        }
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
    const webPushSubscriptionHeader = webPushSubscription
      ? encodeWebPushSubscriptionHeader(webPushSubscription)
      : undefined;

    url.searchParams.delete('chatUuid');
    chatUuids.forEach((chatUuid) => url.searchParams.append('chatUuid', chatUuid));

    closeActiveConnection();
    setState({ status: 'connecting' });

    const abortController = new AbortController();

    connectionAbortController = abortController;
    activeChatUuidsKey = chatUuidsKey;
    void runConnection(url, abortController, webPushSubscriptionHeader).finally(() => {
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

  const connect = ({ chatUuids }: { readonly chatUuids?: string | readonly string[] } = {}): void => {
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

  const enableWebPush = (): Promise<WebPushEnableResult> => {
    if (webPushSubscription) {
      return Promise.resolve({ status: 'enabled', subscription: webPushSubscription });
    }

    if (enableWebPushPromise) return enableWebPushPromise;

    enableWebPushPromise = enableBrowserWebPush({
      applicationServerKey,
    })
      .then((result) => {
        if (result.status === 'enabled') webPushSubscription = result.subscription;
        return result;
      })
      .finally(() => {
        enableWebPushPromise = undefined;
      });

    return enableWebPushPromise;
  };

  return Object.freeze({
    connect,
    disconnect,
    enableWebPush,
    getState,
    reconnect,
    subscribeToEvent,
    subscribeToEvents,
    subscribeToState,
  });
};
