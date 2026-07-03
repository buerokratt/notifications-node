# notifications-node

# /api

## Current SSE notification flow

The API exposes a server-sent events endpoint for browser clients:

```http
GET /public/v1/notifications/events?chatUuid=<chatUuid>
```

Multiple chats can be subscribed to with repeated query values:

```http
GET /public/v1/notifications/events?chatUuid=<chatUuid>&chatUuid=<anotherChatUuid>
```

The endpoint currently sends:

- `heartbeat` events while the SSE connection is open
- real notification events for the subscribed chats

It does not send a separate `connected` event.

```mermaid
flowchart TD
  Client[Browser SSE client] -->|GET /public/v1/notifications/events?chatUuid=...| Controller[PublicNotificationsController]
  Controller --> Service[NotificationService]

  Service -->|first local subscriber for chat| Bind[RabbitMQ bind channel.chat.chatUuid]
  Service -->|last local subscriber leaves| Unbind[RabbitMQ unbind channel.chat.chatUuid]
  Service --> Streams[Local in-memory chat streams]

  Publisher[External notification publisher] -->|routing key: global| Exchange[RabbitMQ topic exchange]
  Publisher -->|routing key: channel.chat.chatUuid| Exchange

  Exchange -->|global binding| QueueA[Instance A queue]
  Exchange -->|global binding| QueueB[Instance B queue]
  Exchange -->|channel.chat.chatUuid binding| QueueA

  QueueA --> RabbitConsumerA[RabbitmqService instance A]
  QueueB --> RabbitConsumerB[RabbitmqService instance B]

  RabbitConsumerA -->|RabbitmqNotificationEvent| EventServiceA[EventService instance A]
  RabbitConsumerB -->|RabbitmqNotificationEvent| EventServiceB[EventService instance B]

  EventServiceA -->|notification.received| NotificationA[NotificationService instance A]
  EventServiceB -->|notification.received| NotificationB[NotificationService instance B]

  NotificationA -->|matching chatUuid only| Client
```

## Global and channel-based routing

RabbitMQ uses a topic exchange for notification delivery.

Every API instance has its own exclusive, auto-delete queue. On startup, each
instance binds its queue to the global routing key:

```text
global
```

Global messages are therefore delivered to every running API instance. Each
instance can then fan the event out to its own local SSE clients if needed.

Chat-specific messages use channel routing keys. In this codebase, the channel
identifier is the chat UUID:

```text
channel.chat.<chatUuid>
```

When the first local SSE subscriber connects for a chat, the API instance binds
its own queue to that chat routing key. When the last local subscriber for that
chat disconnects, the instance unbinds that routing key.

This means:

- global events go to every API instance
- chat events go only to API instances with at least one local subscriber for
  that chat
- SSE delivery after RabbitMQ is local in-memory fanout from
  `NotificationService`

## Local Docker Compose and RabbitMQ

The API directory contains Docker Compose files for running the service with
RabbitMQ.

For local development, use the dev compose file:

```sh
cd api
docker compose -f docker-compose.dev.yml up --build
```

This starts:

- Public API on `http://localhost:3000`
- Private API on `http://localhost:3001`
- RabbitMQ AMQP on `localhost:5672`
- RabbitMQ Management UI on `http://127.0.0.1:15672`

Open the management console in a browser:

```text
http://127.0.0.1:15672
```

Default RabbitMQ management credentials for the official image are:

```text
username: guest
password: guest
```

In the management console, useful places to check are:

- **Exchanges**: verify the topic exchange exists
- **Queues**: verify each running API instance has its own auto-delete queue
- **Bindings**: verify `global` and `channel.chat.<chatUuid>` routing keys
- **Connections / Channels**: verify the API is connected to RabbitMQ

The dev compose file uses the RabbitMQ management image:

```yaml
rabbitmq:4.3-management-alpine
```

The API connects to RabbitMQ inside the Compose network with:

```env
RABBITMQ_URL=amqp://rabbitmq:5672
```

To open an SSE connection locally:

```sh
curl -N "http://127.0.0.1:3000/public/v1/notifications/events?chatUuid=dee9c8da-2b40-4c6a-a31e-db278b6960b1"
```

The stream should emit periodic `heartbeat` events while connected. Real
notification events are emitted when RabbitMQ receives matching chat events for
the subscribed `chatUuid`.

To stop the local stack:

```sh
docker compose -f docker-compose.dev.yml down
```

---

## RabbitMQ heartbeat

RabbitMQ connection heartbeat can be configured directly in `RABBITMQ_URL`.
The current RabbitMQ service passes this URL to `amqplib.connect()`, so no
extra code is needed for the common case.

```env
RABBITMQ_URL=amqp://guest:guest@127.0.0.1:5672?heartbeat=30
```

If the URL already contains query parameters, append `heartbeat` with `&`:

```env
RABBITMQ_URL=amqp://guest:guest@127.0.0.1:5672?vhost=my-vhost&heartbeat=30
```

This controls the RabbitMQ AMQP connection heartbeat. It is separate from SSE
heartbeat events sent to browser clients.

---

## RabbitMQ startup and recovery

The API startup waits for RabbitMQ. During `RabbitmqService.onModuleInit()`, the
service awaits `amqplib.connect()`, and the Nest applications do not finish
starting until RabbitMQ is connected and the consumer and publisher channels are
created.

RabbitMQ connection recovery is handled by `amqplib` recovery options. If
RabbitMQ is unavailable during startup, `amqplib` keeps retrying the initial
connection and startup remains blocked until a connection succeeds. After the
initial connection succeeds, the same recovery configuration reconnects after
connection loss and reruns the channel setup callback. That setup recreates the
consumer and publisher channels, binds the global routing key, restores stored
chat queue bindings, and restarts the consumer when a subscription callback has
already been registered.

Current recovery settings in `RabbitmqService`:

```ts
initialDelay: 100
maxDelay: 5000
factor: 2
jitter: 0.2
maxRetries: Infinity
```

The `reconnect-scheduled` log is attached after the first successful connection,
so it is intended for reconnects after startup. Initial startup retry attempts
are handled inside `amqplib` before the service receives the connected client.

---

## Public and private apps

The service starts two Nest applications from the same `main.ts` process. Each
application is registered from the same `AppModule` with the same environment
file and shared health/config setup, but the public and private HTTP surfaces
are intentionally separated by app type and route prefix.

```mermaid
flowchart TD
  Main[main.ts bootstrap] --> AppModule[AppModule.register app type]
  AppModule --> PublicApp[Public app]
  AppModule --> PrivateApp[Private app]

  PublicApp --> PublicPrefix[Global prefix: /public]
  PrivateApp --> PrivatePrefix[Global prefix: /private]

  PublicApp --> PublicNotifications[PublicNotificationsModule]
  PublicNotifications --> PublicController[PublicNotificationsController]
  PublicController -->|GET /public/v1/notifications/events| SseClients[Browser SSE clients]

  PrivateApp --> PrivateNotifications[PrivateNotificationsModule]
  PrivateNotifications --> PrivateController[PrivateNotificationsController]
  PrivateController -->|POST /private/v1/notifications/events| Publishers[Internal publishers]

  PublicNotifications --> NotificationModule[NotificationModule]
  PrivateNotifications --> NotificationModule
  NotificationModule --> PublicRabbit[RabbitmqModule]
  NotificationModule --> PrivateRabbit[RabbitmqModule]
  PublicRabbit --> Exchange[RabbitMQ topic exchange]
  PrivateRabbit --> Exchange

  Exchange --> PublicService[NotificationService in public app]
  PublicService --> SseClients

  PublicApp --> HealthPublic[/GET /health/]
  PrivateApp --> HealthPrivate[/GET /health/]
```

### Public app

The public app listens on `API_PORT_PUBLIC` or `3000` when the variable is not
set. Its routes are prefixed with `/public`, except `/health`, which is excluded
from the global prefix.

The public notification endpoint is:

```http
GET /public/v1/notifications/events?chatUuid=<chatUuid>
```

This endpoint accepts one or more `chatUuid` query parameters, opens an SSE
stream, emits heartbeat events, binds the local RabbitMQ queue to each requested
chat routing key, and fans matching notification events out to the connected
client.

### Private app

The private app listens on `API_PORT_PRIVATE` or `3001` when the variable is not
set. Its routes are prefixed with `/private`, except `/health`, which is excluded
from the global prefix.

The private notification endpoint is:

```http
POST /private/v1/notifications/events
```

Internal publishers post notification envelopes to this endpoint. The private
app validates the body and publishes accepted events to RabbitMQ. `GLOBAL`
events are published with the `global` routing key, while `CHAT` events require
`recipientUuid` and are published with `channel.chat.<recipientUuid>`.

## Environment variables

The API loads `api/config/<NODE_ENV>.env` and also reads process environment
values. `NODE_ENV` defaults to `development` when it is not set.

| Variable | Required | Description |
| --- | --- | --- |
| `API_CORS_ORIGIN` | Required | CORS origin value passed to `enableCors`; comma-separated values are treated as multiple allowed origins. |
| `API_DOCUMENTATION_ENABLED` | Required | Boolean flag that enables Swagger documentation at `/documentation` on each app. |
| `API_PORT_PUBLIC` | Optional | Port for the public app; defaults to `3000`. |
| `API_PORT_PRIVATE` | Optional | Port for the private app; defaults to `3001`. |
| `RABBITMQ_URL` | Required | AMQP/AMQPS connection URL used by RabbitMQ clients; can include query options such as `heartbeat=30`. |
| `RABBITMQ_PREFIX` | Optional | Prefix for RabbitMQ exchange and queue names, useful for separating environments. |
| `NODE_ENV` | Optional | Selects the config file from `api/config/<NODE_ENV>.env`; defaults to `development`. |
