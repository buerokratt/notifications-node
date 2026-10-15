import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NOTIFICATIONS_SESSION_EXPIRED_EVENT_TYPE,
  WEB_PUSH_SUBSCRIPTION_HEADER,
} from '../../src/core/core.constants.js';
import { createNotificationsClient } from '../../src/core/create-notification-client.js';
import {
  NotificationConnectionHttpError,
  NotificationConnectionLostError,
  NotificationEventParseError,
  NotificationResponseStreamError,
  type NotificationEvent,
  type NotificationsClient,
  type NotificationsConnectionStatus,
} from '../../src/core/index.js';
import { advanceTimers, flushMicrotasks, waitForCondition } from '../helpers/async.helper.js';
import { ControlledFetchHarness } from '../helpers/fetch-sse.helper.js';
import {
  decodeBase64UrlJson,
  installWebPushBrowser,
  SUBSCRIPTION_JSON,
  type WebPushBrowserHarness,
} from '../helpers/web-push.helper.js';

const API_BASE_URL = 'https://notifications.example.test';
const CHAT_A = '89b39d46-bf9a-4f07-a18a-5f574c2aa738';
const CHAT_B = 'c9772e61-f4e8-4f96-9a6a-dc247f497869';
const OFFLINE_ERROR = new Error('offline');
const VAPID_PUBLIC_KEY = 'BGtr18_RnioZdJqSdhw3tHEKwklwzm-er3gnHWYolmx0GW-WhAhT-xu46acxbhRZN3_JTyqkFJPI8kFLkyONsGs';

const sseEvent = (type: string, data: unknown): string => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

describe('createNotificationsClient', () => {
  let fetchHarness: ControlledFetchHarness;
  let webPushHarness: WebPushBrowserHarness;
  const clients: NotificationsClient[] = [];

  const createClient = (): NotificationsClient => {
    const client = createNotificationsClient({ apiBaseUrl: API_BASE_URL, vapidPublicKey: VAPID_PUBLIC_KEY });
    clients.push(client);
    return client;
  };

  const connect = async (client: NotificationsClient, chatUuids: string | string[] = CHAT_A) => {
    client.connect({ chatUuids });
    return fetchHarness.request(fetchHarness.requests.length - 1);
  };

  const waitForStatus = async (client: NotificationsClient, status: NotificationsConnectionStatus): Promise<void> =>
    waitForCondition(() => client.getState().status === status, `client state ${status}`);

  beforeEach(() => {
    fetchHarness = new ControlledFetchHarness();
    fetchHarness.install();
    webPushHarness = installWebPushBrowser();
  });

  afterEach(() => {
    clients.forEach((client) => client.disconnect());
    webPushHarness.restore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('creates an inert frozen client with a frozen initial state', () => {
    const client = createClient();
    const initialState = client.getState();

    expect(fetchHarness.fetch).not.toHaveBeenCalled();
    expect(initialState).toEqual({ status: 'disconnected' });
    expect(Object.isFrozen(initialState)).toBe(true);
    expect(Object.isFrozen(client)).toBe(true);
  });

  it('connects without enabling Web Push and omits the subscription header', async () => {
    fetchHarness.queueSse();
    const client = createClient();

    client.connect({ chatUuids: CHAT_A });
    const request = await fetchHarness.request(0);
    await waitForStatus(client, 'connected');

    expect(new Headers(request.init?.headers).has(WEB_PUSH_SUBSCRIPTION_HEADER)).toBe(false);
    expect(client.getState().status).toBe('connected');
  });

  it('connects after Web Push permission is denied and omits the subscription header', async () => {
    webPushHarness.setPermission('default');
    webPushHarness.setRequestPermissionResult('denied');
    fetchHarness.queueSse();
    const client = createClient();

    await expect(client.enableWebPush()).resolves.toEqual({ status: 'denied' });
    client.connect({ chatUuids: CHAT_A });
    const request = await fetchHarness.request(0);
    await waitForStatus(client, 'connected');

    expect(new Headers(request.init?.headers).has(WEB_PUSH_SUBSCRIPTION_HEADER)).toBe(false);
    expect(client.getState().status).toBe('connected');
  });

  it('deduplicates concurrent Web Push enablement', async () => {
    let resolveReady!: (registration: ServiceWorkerRegistration) => void;
    const ready = new Promise<ServiceWorkerRegistration>((resolve) => {
      resolveReady = resolve;
    });
    webPushHarness.restore();
    webPushHarness = installWebPushBrowser({ ready });
    const client = createClient();

    const first = client.enableWebPush();
    const second = client.enableWebPush();

    expect(second).toBe(first);
    expect(webPushHarness.register).toHaveBeenCalledOnce();

    resolveReady(webPushHarness.registration);
    await expect(first).resolves.toEqual({ status: 'enabled', subscription: webPushHarness.subscription });
  });

  it('caches a successful Web Push subscription', async () => {
    const client = createClient();

    await expect(client.enableWebPush()).resolves.toEqual({
      status: 'enabled',
      subscription: webPushHarness.subscription,
    });
    await expect(client.enableWebPush()).resolves.toEqual({
      status: 'enabled',
      subscription: webPushHarness.subscription,
    });

    expect(webPushHarness.register).toHaveBeenCalledOnce();
    expect(webPushHarness.getSubscription).toHaveBeenCalledOnce();
    expect(webPushHarness.subscribe).toHaveBeenCalledOnce();
  });

  it('retries Web Push enablement after permission denial', async () => {
    webPushHarness.restore();
    webPushHarness = installWebPushBrowser({ permission: 'denied' });
    const client = createClient();

    await expect(client.enableWebPush()).resolves.toEqual({ status: 'denied' });
    webPushHarness.setPermission('granted');
    await expect(client.enableWebPush()).resolves.toEqual({
      status: 'enabled',
      subscription: webPushHarness.subscription,
    });

    expect(webPushHarness.register).toHaveBeenCalledOnce();
  });

  it('retries Web Push enablement after a platform failure', async () => {
    const failure = new Error('registration failed');
    webPushHarness.register.mockRejectedValueOnce(failure);
    const client = createClient();

    await expect(client.enableWebPush()).rejects.toBe(failure);
    await expect(client.enableWebPush()).resolves.toEqual({
      status: 'enabled',
      subscription: webPushHarness.subscription,
    });

    expect(webPushHarness.register).toHaveBeenCalledTimes(2);
  });

  it.each(['', '   ', 'https://notifications.example.test/'])(
    'rejects invalid API base URL %j before creating a client',
    (apiBaseUrl) => {
      expect(() => createNotificationsClient({ apiBaseUrl, vapidPublicKey: VAPID_PUBLIC_KEY })).toThrow(TypeError);
      expect(fetchHarness.fetch).not.toHaveBeenCalled();
    },
  );

  it('uses the fixed endpoint, sorted deduplicated query values, credentials, headers, and an abort signal', async () => {
    const client = createClient();

    await client.enableWebPush();
    client.connect({ chatUuids: [CHAT_B, CHAT_A, CHAT_B] });
    const request = await fetchHarness.request(0);

    expect(request.url).toBe(`${API_BASE_URL}/public/v1/notifications/events?chatUuid=${CHAT_A}&chatUuid=${CHAT_B}`);
    expect(request.init).toMatchObject({
      credentials: 'include',
    });
    const headers = new Headers(request.init?.headers);
    const encodedSubscription = headers.get(WEB_PUSH_SUBSCRIPTION_HEADER);

    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(encodedSubscription).not.toBeNull();
    expect(decodeBase64UrlJson(encodedSubscription!)).toEqual(SUBSCRIPTION_JSON);
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.signal?.aborted).toBe(false);
  });

  it.each([
    ['without arguments', (client: NotificationsClient) => client.connect()],
    ['with empty arguments', (client: NotificationsClient) => client.connect({})],
    // eslint-disable-next-line @typescript-eslint/naming-convention
  ])('connects %s and omits the chatUuid query parameter', async (_label, connectWithoutChats) => {
    const client = createClient();

    connectWithoutChats(client);
    const request = await fetchHarness.request(0);

    expect(request.url).toBe(`${API_BASE_URL}/public/v1/notifications/events`);
  });

  it('does not replace a request for an equivalent subscription', async () => {
    const client = createClient();
    client.connect({ chatUuids: [CHAT_B, CHAT_A, CHAT_B] });
    const first = await fetchHarness.request(0);

    client.connect({ chatUuids: [CHAT_A, CHAT_B] });
    await flushMicrotasks();

    expect(fetchHarness.requests).toHaveLength(1);
    expect(first.signal?.aborted).toBe(false);
  });

  it('aborts and replaces a request when the desired subscription changes', async () => {
    const client = createClient();
    client.connect({ chatUuids: CHAT_A });
    const first = await fetchHarness.request(0);

    client.connect({ chatUuids: CHAT_B });
    const second = await fetchHarness.request(1);

    expect(first.signal?.aborted).toBe(true);
    expect(second.signal?.aborted).toBe(false);
    expect(second.url).toContain(`chatUuid=${CHAT_B}`);
  });

  it('disconnect aborts a pending request and prevents later explicit reconnect', async () => {
    const client = createClient();
    client.connect({ chatUuids: CHAT_A });
    const request = await fetchHarness.request(0);

    client.disconnect();
    client.reconnect();
    await flushMicrotasks();

    expect(request.signal?.aborted).toBe(true);
    expect(client.getState()).toEqual({ status: 'disconnected' });
    expect(fetchHarness.requests).toHaveLength(1);
  });

  it('disconnect aborts an active stream and cancels queued retry work', async () => {
    vi.useFakeTimers();
    const stream = fetchHarness.queueSse();
    const client = createClient();
    client.connect({ chatUuids: CHAT_A });
    const request = await fetchHarness.request(0);
    await waitForStatus(client, 'connected');

    stream.close();
    await waitForStatus(client, 'reconnecting');
    client.disconnect();
    await advanceTimers(10_000);

    expect(request.signal?.aborted).toBe(true);
    expect(fetchHarness.requests).toHaveLength(1);
    expect(client.getState()).toEqual({ status: 'disconnected' });
  });

  it('disconnect aborts a currently connected response stream', async () => {
    const stream = fetchHarness.queueSse();
    const client = createClient();
    client.connect({ chatUuids: CHAT_A });
    const request = await fetchHarness.request(0);
    await waitForStatus(client, 'connected');

    client.disconnect();
    await flushMicrotasks();

    expect(request.signal?.aborted).toBe(true);
    expect(client.getState()).toEqual({ status: 'disconnected' });
    expect(() => stream.write(sseEvent('notice', {}))).toThrow('finished SSE stream');
  });

  it('delivers named and catch-all events and honors idempotent listener cleanup', async () => {
    const stream = fetchHarness.queueSse();
    const client = createClient();
    const named: NotificationEvent<{ readonly id: string }>[] = [];
    const all: NotificationEvent<unknown>[] = [];
    const unsubscribeNamed = client.subscribeToEvent<{ readonly id: string }>('notice', (event) => named.push(event));
    const unsubscribeAll = client.subscribeToEvents((event) => all.push(event));

    await connect(client);
    await waitForStatus(client, 'connected');
    stream.write(sseEvent('notice', { id: 'first' }));
    await waitForCondition(() => named.length === 1 && all.length === 1, 'initial event delivery');

    unsubscribeNamed();
    unsubscribeNamed();
    unsubscribeAll();
    stream.write(sseEvent('notice', { id: 'second' }));
    await flushMicrotasks();

    expect(named).toEqual([{ data: { id: 'first' }, type: 'notice' }]);
    expect(all).toEqual([{ data: { id: 'first' }, type: 'notice' }]);
    expect(Object.isFrozen(named[0])).toBe(true);
  });

  it('parses events split across chunks and multiple events in one chunk', async () => {
    const stream = fetchHarness.queueSse();
    const client = createClient();
    const received: NotificationEvent<unknown>[] = [];
    client.subscribeToEvents((event) => received.push(event));
    await connect(client);
    await waitForStatus(client, 'connected');

    stream.write('event: first\ndata: {"id":');
    stream.write('1}\n\nevent: second\ndata: {"id":2}\n\n');
    await waitForCondition(() => received.length === 2, 'two parsed events');

    expect(received).toEqual([
      { data: { id: 1 }, type: 'first' },
      { data: { id: 2 }, type: 'second' },
    ]);
  });

  it('records malformed JSON and reports its parser error asynchronously', async () => {
    const queuedErrors: unknown[] = [];
    vi.stubGlobal('queueMicrotask', (callback: VoidFunction) => {
      try {
        callback();
      } catch (error) {
        queuedErrors.push(error);
      }
    });
    const stream = fetchHarness.queueSse();
    const client = createClient();
    await connect(client);
    await waitForStatus(client, 'connected');

    stream.write('event: notice\ndata: not-json\n\n');
    await waitForCondition(() => queuedErrors.length === 1, 'queued parser error');

    expect(client.getState().status).toBe('connected');
    const parsingError = client.getState().error;

    expect(parsingError).toBeInstanceOf(NotificationEventParseError);
    expect(queuedErrors[0]).toBe(parsingError);

    if (!(parsingError instanceof NotificationEventParseError)) {
      throw new TypeError('Expected a NotificationEventParseError');
    }

    expect(parsingError.cause).toBeInstanceOf(SyntaxError);
  });

  it('isolates listener failures so later listeners still receive the event', async () => {
    const listenerError = new Error('listener failed');
    const queuedErrors: unknown[] = [];
    vi.stubGlobal('queueMicrotask', (callback: VoidFunction) => {
      try {
        callback();
      } catch (error) {
        queuedErrors.push(error);
      }
    });
    const stream = fetchHarness.queueSse();
    const client = createClient();
    const received: NotificationEvent<unknown>[] = [];
    client.subscribeToEvents(() => {
      throw listenerError;
    });
    client.subscribeToEvents((event) => received.push(event));
    await connect(client);
    await waitForStatus(client, 'connected');

    stream.write(sseEvent('notice', { id: 'delivered' }));
    await waitForCondition(() => received.length === 1, 'healthy listener delivery');

    expect(queuedErrors).toEqual([listenerError]);
    expect(received[0]).toEqual({ data: { id: 'delivered' }, type: 'notice' });
  });

  it.each([
    ['network failure', () => fetchHarness.queueFailure(OFFLINE_ERROR), NotificationConnectionLostError],
    [
      'non-OK response',
      () => fetchHarness.queueResponse(new Response(null, { status: 503 })),
      NotificationConnectionHttpError,
    ],
    [
      'missing body',
      () => fetchHarness.queueResponse(new Response(null, { status: 200 })),
      NotificationResponseStreamError,
    ],
  ])('enters retry with a typed error after %s', async (caseName, arrange, expectedErrorClass) => {
    void caseName;
    vi.useFakeTimers();
    arrange();
    const client = createClient();
    client.connect({ chatUuids: CHAT_A });

    await waitForStatus(client, 'reconnecting');

    const connectionError = client.getState().error;

    expect(connectionError).toBeInstanceOf(expectedErrorClass);

    if (connectionError instanceof NotificationConnectionHttpError) {
      expect(connectionError.status).toBe(503);
    } else if (connectionError instanceof NotificationConnectionLostError) {
      expect(connectionError.cause).toBe(OFFLINE_ERROR);
    }

    expect(fetchHarness.requests).toHaveLength(1);
  });

  it('retries a failed stream only after the default delay', async () => {
    vi.useFakeTimers();
    const stream = fetchHarness.queueSse();
    const client = createClient();
    await client.enableWebPush();
    client.connect({ chatUuids: CHAT_A });
    const firstRequest = await fetchHarness.request(0);
    await waitForStatus(client, 'connected');

    const streamError = new Error('stream failed');
    stream.fail(streamError);
    await waitForStatus(client, 'reconnecting');
    await advanceTimers(2_999);
    expect(fetchHarness.requests).toHaveLength(1);

    await advanceTimers(1);
    const secondRequest = await fetchHarness.request(1);
    const connectionError = client.getState().error;

    expect(connectionError).toBeInstanceOf(NotificationConnectionLostError);

    if (!(connectionError instanceof NotificationConnectionLostError)) {
      throw new TypeError('Expected a NotificationConnectionLostError');
    }

    expect(connectionError.cause).toBe(streamError);
    const firstSubscriptionHeader = new Headers(firstRequest.init?.headers).get(WEB_PUSH_SUBSCRIPTION_HEADER);
    const secondSubscriptionHeader = new Headers(secondRequest.init?.headers).get(WEB_PUSH_SUBSCRIPTION_HEADER);

    expect(firstSubscriptionHeader).not.toBeNull();
    expect(secondSubscriptionHeader).not.toBeNull();
    expect(decodeBase64UrlJson(secondSubscriptionHeader!)).toEqual(SUBSCRIPTION_JSON);
    expect(secondSubscriptionHeader).toBe(firstSubscriptionHeader);
  });

  it('uses the latest SSE retry value after a stream closes', async () => {
    vi.useFakeTimers();
    const stream = fetchHarness.queueSse();
    const client = createClient();
    client.connect({ chatUuids: CHAT_A });
    await waitForStatus(client, 'connected');

    stream.write('retry: 75\n\n');
    stream.close();
    await waitForStatus(client, 'reconnecting');
    await advanceTimers(74);
    expect(fetchHarness.requests).toHaveLength(1);

    await advanceTimers(1);
    await fetchHarness.request(1);
  });

  it('uses the heartbeat payload interval to reset the timeout deadline', async () => {
    vi.useFakeTimers();
    const stream = fetchHarness.queueSse();
    const client = createClient();
    client.connect({ chatUuids: CHAT_A });
    await waitForStatus(client, 'connected');

    stream.write(sseEvent('heartbeat', { heartbeatIntervalMs: 10_000 }));
    await flushMicrotasks();
    await advanceTimers(19_999);
    expect(client.getState().status).toBe('connected');

    await advanceTimers(1);
    await waitForStatus(client, 'reconnecting');
    expect(client.getState().error?.message).toBe('Notification heartbeat timed out');
  });

  it('does not start the heartbeat timeout before the first heartbeat', async () => {
    vi.useFakeTimers();
    fetchHarness.queueSse();
    const client = createClient();
    client.connect();
    await waitForStatus(client, 'connected');

    await advanceTimers(120_000);

    expect(client.getState().status).toBe('connected');
  });

  describe('explicit reconnect', () => {
    it('is a no-op before connect', () => {
      const client = createClient();
      client.reconnect();
      expect(fetchHarness.requests).toHaveLength(0);
      expect(client.getState().status).toBe('disconnected');
    });

    it.each(['connecting', 'connected'] as const)(
      'immediately replaces the sole request while %s and preserves subscriptions',
      async (phase) => {
        const firstStream = phase === 'connecting' ? undefined : fetchHarness.queueSse();
        const client = createClient();
        const listener = vi.fn();
        client.subscribeToEvent('notice', listener);
        await client.enableWebPush();
        client.connect({ chatUuids: [CHAT_B, CHAT_A] });
        const first = await fetchHarness.request(0);
        if (phase !== 'connecting') await waitForStatus(client, 'connected');

        let replacement;
        if (phase === 'connecting') {
          client.reconnect();
          replacement = fetchHarness.queueSse();
        } else {
          replacement = fetchHarness.queueSse();
          client.reconnect();
        }
        const second = await fetchHarness.request(1);
        await waitForStatus(client, 'connected');
        replacement.write(sseEvent('notice', { id: phase }));
        await waitForCondition(() => listener.mock.calls.length === 1, 'preserved listener');

        expect(first.signal?.aborted).toBe(true);
        expect(second.signal?.aborted).toBe(false);
        expect(second.url).toContain(`chatUuid=${CHAT_A}&chatUuid=${CHAT_B}`);
        const firstSubscriptionHeader = new Headers(first.init?.headers).get(WEB_PUSH_SUBSCRIPTION_HEADER);
        const secondSubscriptionHeader = new Headers(second.init?.headers).get(WEB_PUSH_SUBSCRIPTION_HEADER);

        expect(firstSubscriptionHeader).not.toBeNull();
        expect(secondSubscriptionHeader).not.toBeNull();
        expect(decodeBase64UrlJson(secondSubscriptionHeader!)).toEqual(SUBSCRIPTION_JSON);
        expect(secondSubscriptionHeader).toBe(firstSubscriptionHeader);
        expect(listener).toHaveBeenCalledWith({ data: { id: phase }, type: 'notice' });
        firstStream?.close();
      },
    );

    it('cancels a pending retry delay and does not leave its scheduled request behind', async () => {
      vi.useFakeTimers();
      fetchHarness.queueFailure(new Error('offline'));
      const client = createClient();
      client.connect({ chatUuids: CHAT_A });
      await waitForStatus(client, 'reconnecting');

      fetchHarness.queueSse();
      client.reconnect();
      await fetchHarness.request(1);
      await waitForStatus(client, 'connected');
      await advanceTimers(10_000);

      expect(fetchHarness.requests).toHaveLength(2);
      expect(fetchHarness.requests.filter((request) => !request.signal?.aborted)).toHaveLength(1);
    });

    it('clears the replaced request heartbeat and starts a fresh deadline', async () => {
      vi.useFakeTimers();
      const firstStream = fetchHarness.queueSse();
      const client = createClient();
      client.connect({ chatUuids: CHAT_A });
      await waitForStatus(client, 'connected');
      firstStream.write(sseEvent('heartbeat', { heartbeatIntervalMs: 10_000 }));
      await flushMicrotasks();
      await advanceTimers(19_000);

      fetchHarness.queueSse();
      client.reconnect();
      await fetchHarness.request(1);
      await waitForStatus(client, 'connected');
      await advanceTimers(1_000);

      expect(client.getState().status).toBe('connected');
      expect(fetchHarness.requests).toHaveLength(2);
    });
  });

  it('delivers session_expired before shutdown, retains UUIDs, and resumes only after explicit reconnect', async () => {
    vi.useFakeTimers();
    const stream = fetchHarness.queueSse();
    const client = createClient();
    const observedStates: string[] = [];
    client.subscribeToEvent(NOTIFICATIONS_SESSION_EXPIRED_EVENT_TYPE, () => {
      observedStates.push(client.getState().status);
    });
    client.connect({ chatUuids: CHAT_A });
    const first = await fetchHarness.request(0);
    await waitForStatus(client, 'connected');

    stream.write(sseEvent(NOTIFICATIONS_SESSION_EXPIRED_EVENT_TYPE, { reason: 'expired' }));
    await waitForStatus(client, 'session-expired');
    await advanceTimers(30_000);

    expect(observedStates).toEqual(['connected']);
    expect(first.signal?.aborted).toBe(true);
    expect(fetchHarness.requests).toHaveLength(1);

    fetchHarness.queueSse();
    client.reconnect();
    const second = await fetchHarness.request(1);
    await waitForStatus(client, 'connected');
    expect(second.url).toContain(`chatUuid=${CHAT_A}`);
  });

  it('treats HTTP 401 as session expiry without automatic retry and permits parent-driven reconnect', async () => {
    vi.useFakeTimers();
    fetchHarness.queueResponse(new Response(null, { status: 401 }));
    const client = createClient();
    client.connect({ chatUuids: CHAT_B });
    await waitForStatus(client, 'session-expired');
    await advanceTimers(30_000);
    expect(fetchHarness.requests).toHaveLength(1);

    fetchHarness.queueSse();
    client.reconnect();
    const second = await fetchHarness.request(1);
    await waitForStatus(client, 'connected');
    expect(second.url).toContain(`chatUuid=${CHAT_B}`);
  });

  it('notifies state subscribers on changes and stops after cleanup', async () => {
    const client = createClient();
    const snapshots: string[] = [];
    const unsubscribe = client.subscribeToState(() => snapshots.push(client.getState().status));

    client.connect({ chatUuids: CHAT_A });
    await fetchHarness.request(0);
    unsubscribe();
    client.disconnect();

    expect(snapshots).toEqual(['connecting']);
  });
});
