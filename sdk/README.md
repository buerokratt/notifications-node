# `@buerokratt-ria/notifications`

Browser notifications client and React bindings for receiving Buerokratt notification events over
server-sent events (SSE).

The SDK:

- connects one browser client to notifications for one or more chats;
- sends the browser's cookies with the request;
- parses SSE messages into typed notification events;
- exposes React hooks for named, filtered, or catch-all event subscriptions;
- reports connection, reconnection, and expired-session states; and
- reconnects automatically after a lost connection or heartbeat timeout.

React is the recommended integration. A shorter framework-agnostic example is included under
[Using the core client without React](#using-the-core-client-without-react).

## Requirements

- React 18 or newer when using the React bindings
- A browser environment with `fetch`, `ReadableStream`, `TextDecoderStream`, and `AbortController`
- A notifications API that exposes `/public/v1/notifications/events`
- Browser credentials accepted by the notifications API

The SDK is ESM-only. React is declared as an optional peer dependency; install it when using the
React-first integration documented here.

## Installation

```sh
pnpm add @buerokratt-ria/notifications
```
or
```sh
npm i @buerokratt-ria/notifications
```

The package has two public entry points:

```ts
// Framework-agnostic client and shared types
import { createNotificationsClient } from '@buerokratt-ria/notifications';

// React provider, hooks, and React-specific types
import { NotificationsProvider } from '@buerokratt-ria/notifications/react';
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

`apiBaseUrl` must be a non-empty absolute URL without a trailing slash. The client does not connect
when it is created.

Using a notifications hook outside the provider throws an error. Nested components share the exact
client passed to the provider.

### 2. Connect for the active chats

Connect when a component needs notifications and disconnect during effect cleanup. One connection can
subscribe to a single chat UUID or several chat UUIDs.

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
    if (chatUuids.length === 0) return;

    connect({ chatUuids: [...chatUuids] });

    return disconnect;
  }, [chatUuids, connect, disconnect]);

  return null;
}
```

Mount this connection-owning component once for the relevant application or route. Calling `connect`
with a different chat set replaces the current stream. Equivalent chat sets are deduplicated and do
not replace the stream.

`disconnect` closes the stream, cancels queued automatic retries, clears the remembered chat set, and
sets the status to `disconnected`.

> The `chatUuids` array should have a stable reference when its contents have not changed. For example,
> derive it with `useMemo` instead of creating a new array during every render.

### 3. Handle a named event

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

The client requests this endpoint for the selected chats:

```http
GET <apiBaseUrl>/public/v1/notifications/events?chatUuid=<chatUuid>
Accept: text/event-stream
```

It uses `fetch` with `credentials: 'include'`; applications do not pass a token to the SDK. The browser
must already have the authentication cookie expected by the notifications API.

For a cross-origin API, configure the API's CORS and cookie attributes to allow credentialed requests
from the frontend origin. The SDK cannot override browser cookie or CORS policy.

Do not call `connect` during server rendering. Open the stream from an effect in the browser, as shown
in the quick start.

## Reconnection and errors

The client manages the stream lifecycle as follows:

1. `connect` opens the SSE request and sets the status to `connecting`.
2. A successful response with a readable body sets the status to `connected`.
3. A lost stream, failed request, invalid response, or 60-second heartbeat timeout sets the status to
   `reconnecting` and stores the failure in `state.error`.
4. The client retries after three seconds by default. An SSE `retry` field can change that delay.
5. HTTP 401 or a `session_expired` event sets the status to `session-expired` and stops retrying.

Malformed JSON is not delivered as an event. The parsing error is stored on the current connection
state and is also thrown asynchronously. Errors thrown by event listeners are likewise rethrown
asynchronously so that one failing listener does not prevent later listeners from running.

Application error monitoring should therefore observe both connection state and global browser errors.

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
}
```

#### `NotificationsClient`

| Member | Description |
| --- | --- |
| `connect({ chatUuids })` | Opens or replaces the stream for a string or string array of chat UUIDs. |
| `disconnect()` | Closes the stream, cancels retries, forgets the chat set, and enters `disconnected`. |
| `reconnect()` | Reopens the last requested chat set. Does nothing if no chat set is remembered. |
| `getState()` | Returns the current immutable `NotificationsConnectionState` snapshot. |
| `subscribeToState(listener)` | Registers a state-change listener and returns an unsubscribe function. |
| `subscribeToEvent<TData>(eventType, listener)` | Registers a named-event listener and returns an unsubscribe function. |
| `subscribeToEvents(listener)` | Registers a catch-all listener and returns an unsubscribe function. |

The entry point also exports these types:

- `NotificationData<TPayload>`: the Buerokratt event envelope, including event UUID, type, payload,
  and either a global or chat recipient.
- `NotificationEvent<TData>`: the parsed SSE event as `{ type, data }`.
- `NotificationsClient`
- `NotificationsClientConfig`
- `NotificationsConnectionState`
- `NotificationsConnectionStateListener`
- `NotificationsConnectionStatus`

### React entry point: `@buerokratt-ria/notifications/react`

#### `<NotificationsProvider client={client}>`

Makes one `NotificationsClient` available to descendant hooks.

#### `useNotificationsClient()`

Returns the shared client's `connect`, `disconnect`, `reconnect`, `getState`, and `subscribeToState`
members. Raw event subscription methods are intentionally exposed through the event hooks instead.

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
├── index.ts    Base package entry point
└── react.ts    React subpath entry point
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

- `build` compiles both public entry points into `dist`.
- `lint:check` checks source and test files without fixing them.
- `test:typecheck` checks the SDK test TypeScript configuration.
- `test:run` runs the Vitest suite once.
- `pack:check` builds and creates a package archive under `/tmp` so its published contents can be
  inspected without publishing.

When changing the public API, update both `src/index.ts` and `src/react.ts` as appropriate, then keep
this README's imports and API reference aligned with the package exports in `package.json`.
