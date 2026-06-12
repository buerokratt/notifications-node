# notifications-node

# /api

## Current SSE notification flow

The API exposes a server-sent events endpoint for browser clients:

```http
GET /v1/notifications/events?chatUuid=<chatUuid>
```

Multiple chats can be subscribed to with repeated query values:

```http
GET /v1/notifications/events?chatUuid=<chatUuid>&chatUuid=<anotherChatUuid>
```

The endpoint currently sends:

- `heartbeat` events while the SSE connection is open
- real notification events for the subscribed chats

It does not send a separate `connected` event.

```mermaid
flowchart TD
  Client[Browser SSE client] -->|GET /v1/notifications/events?chatUuid=...| Controller[NotificationController]
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

- API on `http://localhost:3000`
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
curl -N "http://127.0.0.1:3000/v1/notifications/events?chatUuid=dee9c8da-2b40-4c6a-a31e-db278b6960b1"
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
