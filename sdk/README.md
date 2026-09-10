# `@buerokratt-ria/notifications`

Browser notifications client and React bindings for receiving Buerokratt notification events over
server-sent events (SSE).

The SDK:

- connects one browser client to global and authenticated-user notifications, optionally for one or more chats;
- sends the browser's cookies with the request;
- parses SSE messages into typed notification events;
- exposes React hooks for named, filtered, or catch-all event subscriptions;
- reports connection, reconnection, and expired-session states; and
- reconnects automatically after a lost connection or heartbeat timeout.

React is the recommended integration. A shorter framework-agnostic example is included under
[Using the core client without React](#using-the-core-client-without-react).

## Requirements

- React 18 or newer when using the React bindings
- A browser environment with `fetch`, `ReadableStream`, `TextDecoderStream`, `AbortController`, and `atob`
- For optional Web Push: browser support for `Notification`, `navigator.serviceWorker`, `PushManager`,
  `TextEncoder`, and `btoa`
- A notifications API that exposes `/public/v1/notifications/events`
- Browser credentials accepted by the notifications API

The SDK is ESM-only. React is declared as an optional peer dependency; install it when using the
React-first integration documented here.

Web Push and service workers require a secure context. Use HTTPS in deployed environments; browsers
may make development exceptions for localhost.

## Installation

```sh
pnpm add @buerokratt-ria/notifications
```
or
```sh
npm i @buerokratt-ria/notifications
```

The package has three public entry points:

```ts
// Framework-agnostic client and shared types
import { createNotificationsClient } from '@buerokratt-ria/notifications';

// React provider, hooks, and React-specific types
import { NotificationsProvider } from '@buerokratt-ria/notifications/react';

// Optional Vite integration for deploying the service worker
import { notificationsServiceWorker } from '@buerokratt-ria/notifications/vite';
```

## React quick start

### 1. Create and provide one client

Create the client once, outside the React component tree. This keeps its connection and subscriptions
stable across renders. Then place `NotificationsProvider` above every component that uses notifications
hooks.

```tsx
import type { PropsWithChildren } from 'react';
import { createNotificationsClient } from '@buerokratt-ria/notifications';
import { NotificationsProvider } from '@buerokratt-ria/notifications/react';

const notificationsClient = createNotificationsClient({
  apiBaseUrl: 'https://notifications.example.com',
  vapidPublicKey: '<public VAPID key supplied by application configuration>',
});

export function NotificationsRoot({ children }: PropsWithChildren) {
  return (
    <NotificationsProvider client={notificationsClient}>
      {children}
    </NotificationsProvider>
  );
}
```

The package exports the `createNotificationsClient` factory, not a preconfigured `notificationsClient`
instance. The application owns that instance because it supplies the environment-specific API URL.

`apiBaseUrl` must be a non-empty absolute URL without a trailing slash. `vapidPublicKey` must be a
non-empty, base64url-encoded, uncompressed P-256 public key. Empty values, a trailing-slash API URL,
and an invalid VAPID key fail when the client is created, before any permission prompt. The API URL is
resolved when `connect()` is called. The client does not connect when it is created.

Using a notifications hook outside the provider throws an error. Nested components share the exact
client passed to the provider.

### 2. Deploy the default service worker

Vite applications can serve the worker during development and emit it into the production output
automatically with the optional SDK integration:

```ts
import { defineConfig } from 'vite';
import { notificationsServiceWorker } from '@buerokratt-ria/notifications/vite';

export default defineConfig({
  plugins: [notificationsServiceWorker()],
});
```

The plugin deploys the worker at the fixed same-origin URL
`/notifications-service-worker.js`. The browser core remains independent of Vite and React, and
importing the browser SDK does not execute or register the worker.

Non-Vite applications must copy the package's standalone worker:

```text
node_modules/@buerokratt-ria/notifications/dist/notifications-service-worker.js
```

to the web root so it is deployed as:

```text
/notifications-service-worker.js
```

For an S3 or CDN deployment, include the worker beside the application's root `index.html`, serve it
with a JavaScript content type, and do not redirect the worker request to the SPA entry point. Because
the worker is registered from the web root with the default scope, it controls the root scope. A
restrictive `Service-Worker-Allowed` response header can cause registration to fail.

The default worker displays the API payload's non-empty `notification.title` and `notification.body`.
Custom worker behavior is a future extension point; interoperability with replacement workers is not
part of phase one.

### 3. Enable Web Push from an explicit user action

Applications control the notification permission prompt. Call `enableWebPush()` from an intentional
user action such as a button; do not call it automatically on page load while permission is `default`.

```tsx
import { useNotificationsClient } from '@buerokratt-ria/notifications/react';

export function EnableNotificationsButton() {
  const client = useNotificationsClient();

  const enable = async () => {
    const result = await client.enableWebPush();

    if (result.status === 'denied') {
      console.info('Notification permission was not granted');
    } else if (result.status === 'unsupported') {
      console.info('This browser does not support Web Push');
    }
  };

  return <button onClick={() => void enable()}>Enable notifications</button>;
}
```

`denied` and `unsupported` are normal results. Worker registration, Push API, or provider failures
reject the promise with an error. Concurrent enablement calls share one operation, and a successful
subscription is retained for later connections.

### 4. Connect, optionally for active chats

Web Push is optional. `connect()` opens the SSE connection whether notifications are enabled, denied,
or unsupported, and it never prompts for permission. If you want Web Push, enable it separately from
an explicit user action before connecting so the initial SSE request can include the subscription. A
Web Push failure must not prevent the application from connecting SSE. Without arguments, the connection
receives global notifications and notifications for the authenticated user when the API recognizes a user
identity cookie. One connection can additionally subscribe to a single chat UUID or several chat UUIDs.

```ts
notificationsClient.connect();
```

To include chat notifications:

```ts
notificationsClient.connect({ chatUuids });
```

When a component owns an active connection, disconnect during effect cleanup:

```tsx
// chat-notifications.tsx
import { useEffect } from 'react';
import { useNotificationsClient } from '@buerokratt-ria/notifications/react';

interface ChatNotificationsProps {
  readonly chatUuids: readonly string[];
}

export function ChatNotifications({ chatUuids }: ChatNotificationsProps) {
  const { connect, disconnect } = useNotificationsClient();

  useEffect(() => {
    connect(chatUuids.length === 0 ? undefined : { chatUuids });

    return disconnect;
  }, [chatUuids, connect, disconnect]);

  return null;
}
```

Mount this connection-owning component once for the relevant application or route. Calling `connect`
with a different chat set replaces the current stream. Calls without chats and equivalent chat sets are
deduplicated and do not replace the stream.

`disconnect` closes the stream, cancels queued automatic retries, clears the remembered chat set, and
sets the status to `disconnected`. It deliberately keeps the browser Push subscription so a later
connection can reuse it; it does not call `PushSubscription.unsubscribe()`.

> The `chatUuids` array should have a stable reference when its contents have not changed. For example,
> derive it with `useMemo` instead of creating a new array during every render.

### 5. Handle a named event

Use `useNotificationEvent` when a component cares about one event type. Pass the expected event data
type as its generic parameter.

```tsx
import { useNotificationEvent } from '@buerokratt-ria/notifications/react';
import type { NotificationData } from '@buerokratt-ria/notifications';

interface MessageCreatedPayload {
  readonly author: string;
  readonly message: string;
}

type MessageCreatedData = NotificationData<MessageCreatedPayload>;

export function NewMessageListener() {
  useNotificationEvent<MessageCreatedData>('message.created', ({ data, type }) => {
    console.info(`Received ${type} from ${data.payload.author}: ${data.payload.message}`);
  });

  return null;
}
```

The hook subscribes on mount, switches subscriptions if `eventType` changes, and unsubscribes on
unmount. It always calls the latest listener without resubscribing merely because the callback changed.

The generic type is a TypeScript assertion about the server contract; the SDK parses JSON but does not
validate payloads at runtime.

## Connection state

`useNotificationsClient` exposes an external-store-compatible state API. Use React's
`useSyncExternalStore` to rerender when the state changes.

```tsx
import { useSyncExternalStore } from 'react';
import { useNotificationsClient } from '@buerokratt-ria/notifications/react';

export function NotificationsConnectionStatus() {
  const client = useNotificationsClient();
  const state = useSyncExternalStore(client.subscribeToState, client.getState, client.getState);

  if (state.status === 'session-expired') {
    return <p>Your session has expired. Sign in again to resume notifications.</p>;
  }

  if (state.status === 'reconnecting') {
    return <p role="status">Notifications are reconnecting: {state.error?.message}</p>;
  }

  return <p role="status">Notifications: {state.status}</p>;
}
```

The possible statuses are:

| Status | Meaning |
| --- | --- |
| `disconnected` | No stream is active. This is the initial state and the state after `disconnect()`. |
| `connecting` | A stream request has started but has not produced a successful response yet. |
| `connected` | The API returned a readable successful SSE response. |
| `reconnecting` | The stream failed or timed out and the client is waiting to retry. `error` describes the last failure. |
| `session-expired` | The API returned HTTP 401 or sent a `session_expired` SSE event. Automatic retry stops. |

Call `reconnect()` after credentials have been refreshed to reopen the last requested chat set. It does
nothing after `disconnect()`, because disconnecting deliberately clears that set.

```tsx
import { useNotificationsClient } from '@buerokratt-ria/notifications/react';

export function ReconnectNotificationsButton() {
  const { reconnect } = useNotificationsClient();

  return <button onClick={reconnect}>Reconnect notifications</button>;
}
```

## Listening to multiple event types

Use `useNotificationEvents` for several event types or for a catch-all listener.

### Filter selected event types

```tsx
import { useNotificationEvents } from '@buerokratt-ria/notifications/react';

const visibleEventTypes = ['message.created', 'message.updated'] as const;

export function MessageActivityListener() {
  useNotificationEvents({
    eventTypes: visibleEventTypes,
    listener: (event) => {
      console.info('Message activity', event.type, event.data);
    },
  });

  return null;
}
```

### Listen to every event

Omit `eventTypes`, or pass `'*'`, to receive every parsed SSE event.

```tsx
import { useNotificationEvents } from '@buerokratt-ria/notifications/react';

export function NotificationsLogger() {
  useNotificationEvents({
    listener: ({ type, data }) => {
      console.debug('[notifications]', type, data);
    },
  });

  return null;
}
```

Catch-all listeners also receive protocol events such as `heartbeat` and `session_expired`. Filter by
event type when only application events are relevant.

## Authentication and browser behavior

The client requests this endpoint, adding repeated `chatUuid` parameters only for selected chats:

```http
GET <apiBaseUrl>/public/v1/notifications/events[?chatUuid=<chatUuid>]
Accept: text/event-stream
X-Buerokratt-Web-Push-Subscription: <base64url PushSubscription JSON, when enabled>
```

It uses `fetch` with `credentials: 'include'`; applications do not pass a token to the SDK. The browser
must already have the authentication cookie expected by the notifications API.

When Web Push is enabled, the subscription header is included on initial and retried SSE requests. It
is an unpadded base64url encoding of the complete JSON returned by the browser's
`PushSubscription.toJSON()` method. The standard representation includes `endpoint`, `expirationTime`,
and the `auth` and `p256dh` keys. Without a subscription—including when permission is denied or Web
Push is unsupported—the SSE connection still works and omits this header.

For a cross-origin API, configure the API's CORS and cookie attributes to allow credentialed requests
from the frontend origin. The SDK cannot override browser cookie or CORS policy.

Do not call `connect` during server rendering. In unsupported environments, `enableWebPush()` resolves
with `{ status: 'unsupported' }`. Open the stream from an effect in the browser, as shown in the quick
start.

## Reconnection and errors

The client manages the stream lifecycle as follows:

1. `connect` opens the SSE request and sets the status to `connecting`.
2. A successful response with a readable body sets the status to `connected`.
3. A lost stream, failed request, invalid response, or heartbeat timeout sets the status to `reconnecting`
   and stores the failure in `state.error`. The first heartbeat starts the watchdog, and every heartbeat's
   `heartbeatIntervalMs` sets its deadline to twice that interval.
4. The client retries after three seconds by default. An SSE `retry` field can change that delay.
5. HTTP 401 or a `session_expired` event sets the status to `session-expired` and stops retrying.

Connection-state errors use public classes that applications can distinguish with `instanceof`:

```ts
import {
  NotificationConnectionHttpError,
  NotificationConnectionLostError,
  NotificationHeartbeatTimeoutError,
} from '@buerokratt-ria/notifications';

const { error } = notificationsClient.getState();

if (error instanceof NotificationConnectionHttpError) {
  console.error('Notification endpoint returned', error.status);
} else if (error instanceof NotificationHeartbeatTimeoutError) {
  console.error('Notification connection timed out');
} else if (error instanceof NotificationConnectionLostError) {
  console.error('Notification connection failed', error.cause);
}
```

Connection state exposes `NotificationConnectionHttpError`, `NotificationConnectionLostError`,
`NotificationEventParseError`, `NotificationHeartbeatTimeoutError`, or
`NotificationResponseStreamError`. Native fetch, stream, and parse failures are retained as the
`cause` of `NotificationConnectionLostError` or `NotificationEventParseError`.

Malformed JSON is not delivered as an event. The parsing error is stored on the current connection
state and is also thrown asynchronously. Errors thrown by event listeners are likewise rethrown
asynchronously so that one failing listener does not prevent later listeners from running.

Application error monitoring should therefore observe both connection state and global browser errors.

Web Push permission denial and unsupported browsers resolve normally from `enableWebPush()`. Invalid
VAPID configuration fails during client creation, while an unusable API URL can fail when `connect()`
constructs the endpoint. Unexpected worker registration or subscription failures reject the enablement
promise. The default worker displays title and body only. It does not implement notification actions,
icons, badges, custom data, background synchronization, or click navigation; the API payload does not
provide destination data for a `notificationclick` handler.

## Using the core client without React

The core client uses the same connection behavior without React. Keep every unsubscribe function and
call `disconnect` when the integration is disposed.

```ts
import {
  createNotificationsClient,
  type NotificationData,
  type NotificationsConnectionState,
} from '@buerokratt-ria/notifications';

interface AssignmentPayload {
  readonly assignee: string;
}

const client = createNotificationsClient({
  apiBaseUrl: 'https://notifications.example.com',
  vapidPublicKey: '<public VAPID key supplied by application configuration>',
});

const unsubscribeFromState = client.subscribeToState(() => {
  const state: NotificationsConnectionState = client.getState();
  console.info('Notifications state:', state.status, state.error);
});

const unsubscribeFromAssignments = client.subscribeToEvent<NotificationData<AssignmentPayload>>(
  'assignment.created',
  ({ data }) => {
    console.info('Assigned to:', data.payload.assignee);
  },
);

// Optional: call client.enableWebPush() separately from an explicit user action.
client.connect({
  chatUuids: ['89b39d46-bf9a-4f07-a18a-5f574c2aa738'],
});

export function disposeNotifications() {
  unsubscribeFromAssignments();
  unsubscribeFromState();
  client.disconnect();
}
```

## API reference

### Core entry point: `@buerokratt-ria/notifications`

#### `createNotificationsClient(config)`

Creates an inert, framework-agnostic `NotificationsClient`.

```ts
interface NotificationsClientConfig {
  readonly apiBaseUrl: string;
  readonly vapidPublicKey: string;
}
```

#### `NotificationsClient`

| Member | Description |
| --- | --- |
| `enableWebPush()` | Explicitly requests permission and creates or reuses the configured browser Push subscription. |
| `connect()` | Opens or replaces the stream for global and authenticated-user notifications. |
| `connect({ chatUuids })` | Also subscribes to a string or readonly string array of chat UUIDs. |
| `disconnect()` | Closes the stream, cancels retries, forgets the chat set, and keeps the Push subscription. |
| `reconnect()` | Reopens the last requested chat set. Does nothing if no chat set is remembered. |
| `getState()` | Returns the current immutable `NotificationsConnectionState` snapshot. |
| `subscribeToState(listener)` | Registers a state-change listener and returns an unsubscribe function. |
| `subscribeToEvent<TData>(eventType, listener)` | Registers a named-event listener and returns an unsubscribe function. |
| `subscribeToEvents(listener)` | Registers a catch-all listener and returns an unsubscribe function. |

The entry point also exports these types:

- `NotificationData<TPayload>`: the Buerokratt event envelope, including event UUID, type, payload,
  and a global, chat, or user recipient.
- `NotificationHeartbeatData`: heartbeat payload containing `heartbeatIntervalMs`.
- `NotificationClientError`: the union of public errors exposed through notification connection state.
- `NotificationEvent<TData>`: the parsed SSE event as `{ type, data }`.
- `NotificationsClient`
- `NotificationsClientConfig`
- `NotificationsConnectionState`
- `NotificationsConnectionStateListener`
- `NotificationsConnectionStatus`
- `WebPushEnableResult`

### React entry point: `@buerokratt-ria/notifications/react`

#### `<NotificationsProvider client={client}>`

Makes one `NotificationsClient` available to descendant hooks.

#### `useNotificationsClient()`

Returns the shared client's `enableWebPush`, `connect`, `disconnect`, `reconnect`, `getState`, and
`subscribeToState` members. Raw event subscription methods are intentionally exposed through the event
hooks instead.

#### `useNotificationEvent<TData>(eventType, listener)`

Subscribes the component to one named event and manages cleanup automatically.

#### `useNotificationEvents({ eventTypes, listener })`

Subscribes the component to the catch-all stream and optionally filters it. `eventTypes` defaults to
`'*'` and otherwise accepts a readonly string array.

The React entry point also exports the `UseNotificationEventsArgs` type.

## Maintainer guide

The SDK source is under `sdk/src`:

```text
src/
├── core/       Framework-agnostic client, interfaces, and types
├── react/      Provider, hooks, and React-specific interfaces
├── worker/     Standalone default Web Push service worker
├── index.ts    Base package entry point
├── react.ts    React subpath entry point
└── vite.ts     Optional Vite worker-deployment entry point
```

### TypeScript 6 and 7 toolchain

The SDK installs TypeScript 7 and the TypeScript 6 compatibility package side by side:

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

These are npm aliases: the dependency name on the left is the local package name, while the value after
`npm:` identifies the package fetched from the registry.

- `@typescript/native` installs TypeScript 7 under a second local name. It provides the native `tsc`
  executable used by `pnpm run build` and `pnpm run test:typecheck`.
- `typescript` installs the TypeScript 6 compatibility package under the standard name expected by
  tools that import the compiler API, including `typescript-eslint`.
- The compatibility package provides a separate `tsc6` executable, avoiding a name collision with the
  TypeScript 7 `tsc` executable.
- Both packages are development dependencies and are not installed by applications consuming the SDK.

This is the side-by-side setup recommended in the official
[TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0).
The alias syntax is documented in the official
[npm package specification](https://docs.npmjs.com/cli/v8/using-npm/package-spec/#aliases).

Keep both aliases while SDK tooling still requires the TypeScript 6 compiler API. Reassess the
compatibility dependency when those tools support the TypeScript 7 API.

From the `sdk` directory, install dependencies and use the package scripts:

```sh
pnpm install
pnpm run build
pnpm run lint:check
pnpm run test:typecheck
pnpm run test:run
pnpm run pack:check
```

- `build` compiles the core, React, and Vite entry points and the standalone
  `dist/notifications-service-worker.js` asset.
- `lint:check` checks source and test files without fixing them.
- `test:typecheck` checks the SDK test TypeScript configuration.
- `test:run` runs the Vitest suite once.
- `pack:check` builds and creates a package archive under `/tmp` so its published contents can be
  inspected without publishing.

When changing the public API, update both `src/index.ts` and `src/react.ts` as appropriate, then keep
this README's imports and API reference aligned with the package exports in `package.json`.
