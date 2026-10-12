# notifications-node

## Notifications SDK

The repository includes a React-first notifications SDK. See the [SDK README](sdk/README.md) for
TypeScript examples, connection lifecycle, API reference, and maintainer guidance.

> **TODO:** The SDK package is not published yet. Document the publishing process before releasing it.

# /api

[Production deployment](#production-deployment)

## Current SSE notification flow

The API exposes a server-sent events endpoint for browser clients:

```http
GET /public/v1/notifications/events
```

The optional `chatUuid` query parameter subscribes the connection to a chat.
Multiple chats can be subscribed to with repeated query values:

```http
GET /public/v1/notifications/events?chatUuid=<chatUuid>&chatUuid=<anotherChatUuid>
```

The endpoint currently sends:

- `heartbeat` events while the SSE connection is open
- `GLOBAL` notification events
- notification events for the requested `CHAT` recipients
- notification events for the authenticated `USER` recipient when the request
  uses `customJwtCookie`

Each heartbeat includes the interval until the next expected heartbeat:

```json
{
  "heartbeatIntervalMs": 30000
}
```

It does not send a separate `connected` event.

```mermaid
flowchart TD
  Client[Browser SSE client] -->|GET /public/v1/notifications/events with optional chatUuid| Controller[PublicNotificationsController]
  Controller --> Service[NotificationService]

  Service -->|first local subscriber for recipient| Bind[RabbitMQ bind channel.chat.chatUuid or channel.user.userUuid]
  Service -->|last local subscriber leaves| Unbind[RabbitMQ unbind recipient channel]
  Service --> Streams[Local in-memory recipient streams]

  Publisher[External notification publisher] -->|routing key: global| Exchange[RabbitMQ topic exchange]
  Publisher -->|routing key: channel.chat.chatUuid| Exchange
  Publisher -->|routing key: channel.user.userUuid| Exchange

  Exchange -->|global binding| QueueA[Instance A queue]
  Exchange -->|global binding| QueueB[Instance B queue]
  Exchange -->|channel.chat.chatUuid binding| QueueA
  Exchange -->|channel.user.userUuid binding| QueueA

  QueueA --> RabbitConsumerA[RabbitmqService instance A]
  QueueB --> RabbitConsumerB[RabbitmqService instance B]

  RabbitConsumerA -->|RabbitmqNotificationEvent| EventServiceA[EventService instance A]
  RabbitConsumerB -->|RabbitmqNotificationEvent| EventServiceB[EventService instance B]

  EventServiceA -->|notification.received| NotificationA[NotificationService instance A]
  EventServiceB -->|notification.received| NotificationB[NotificationService instance B]

  NotificationA -->|matching GLOBAL, CHAT, or USER target| Client
```

---

## Global and channel-based routing

RabbitMQ uses a topic exchange for notification delivery.

Every API instance has its own exclusive, auto-delete queue. On startup, each
instance binds its queue to the global routing key:

```text
global
```

Global messages are therefore delivered to every running API instance. Each
instance can then fan the event out to its own local SSE clients if needed.

Recipient-specific messages use channel routing keys:

```text
channel.chat.<chatUuid>
channel.user.<userUuid>
```

When the first local SSE subscriber connects for a chat or user, the API
instance binds its own queue to that recipient routing key. When the last local
subscriber for that recipient disconnects, the instance unbinds that routing
key.

This means:

- global events go to every API instance
- chat events go only to API instances with at least one local subscriber for
  that chat
- user events go only to API instances with at least one local subscriber for
  that user
- SSE delivery after RabbitMQ is local in-memory fanout from
  `NotificationService`

---

## Local Docker Compose and RabbitMQ

The API directory contains Docker Compose files for running the service with
RabbitMQ.

Local development depends on a local TIM image for JWT generation and
validation. Clone TIM and build the image before starting this service:

- Clone [TIM](https://github.com/buerokratt/TIM).
- Navigate to the TIM directory.
- Build the image with `docker build -t tim .`

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

To generate a local TIM JWT for the SSE request:

```sh
curl -i -X POST "http://localhost:8085/jwt/custom-jwt-generate" \
  -H "Content-Type: application/json" \
  -d '{"JWTName":"chatJwt","expirationInMinutes":1280,"content":{"login":"EE30303039914"}}'
```

To open an SSE connection locally:

```sh
curl -N \
  -H "Cookie: chatJwt=<tim-jwt>" \
  "http://127.0.0.1:3000/public/v1/notifications/events?chatUuid=dee9c8da-2b40-4c6a-a31e-db278b6960b1"
```

Replace `<tim-jwt>` with a TIM-valid JWT. The stream should emit periodic
`heartbeat` events while connected. Real notification events are emitted when
RabbitMQ receives matching chat events for the subscribed `chatUuid`.

NB: The cookie name depends on the `TIM_JWT_COOKIE_NAMES` environment value
order. `chatJwt` is used here because it is first in `development.env`.

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

---

## Authentication

The public SSE endpoint and private publish endpoint use `@TimAuthentication()`, which
adds `TimTokenGuard` and Swagger cookie authentication metadata. Requests to
those endpoints must include a valid TIM JWT in one of the configured cookie
names from `TIM_JWT_COOKIE_NAMES`. The shared `/health` endpoint does not use
the guard and remains public.

The guard checks the configured cookie names in order and uses the first cookie
that is present. It validates that token by calling TIM:

```http
POST <TIM_URL>/jwt/custom-jwt-verify
```

The cookie name is sent as a `text/plain` request body and the original cookie
is forwarded in the `Cookie` header. A `200 OK` response from TIM is treated as
valid. Missing, rejected, or unverifiable JWTs return `401 Unauthorized`.

```mermaid
flowchart LR
  Request[HTTP request] --> Guard[TimTokenGuard]
  Guard --> Cookies[Find first configured JWT cookie]
  Cookies --> InitialTim[POST TIM /jwt/custom-jwt-verify]
  InitialTim --> InitialValid{200 OK?}
  InitialValid -->|yes| Controller[Controller handler]
  InitialValid -->|no| Unauthorized[401 Unauthorized]

  Sse[Open SSE connection] --> Revalidate[Periodic token revalidation]
  Revalidate --> RevalidationTim[POST TIM /jwt/custom-jwt-verify]
  RevalidationTim --> StillValid{200 OK?}
  StillValid -->|yes| Sse
  StillValid -->|no| SessionExpired[Emit session_expired]
  SessionExpired --> Close[Close client connection]
```

### Public app

The public app listens on `API_PORT_PUBLIC` or `3000` when the variable is not
set. Its routes are prefixed with `/public`, except `/health`, which is excluded
from the global prefix.

The public notification endpoint is:

```http
GET /public/v1/notifications/events
```

This endpoint opens an SSE stream and emits heartbeat and `GLOBAL` notification
events. It optionally accepts one or more `chatUuid` query parameters and binds
the local RabbitMQ queue to each requested chat routing key.

When the request is authenticated with `customJwtCookie`, the JWT must contain a
valid `idCode` value matching `^EE\d{11}$`. The service deterministically
normalizes that identifier to a UUID v5, binds the corresponding USER routing
key, and delivers events for that authenticated user. A missing or invalid
`idCode` returns `401 Unauthorized`. Other configured TIM JWT cookies do not add
a USER subscription; without `chatUuid`, those connections receive only
`GLOBAL` events.

The SSE request is authenticated before the stream is opened. While the stream
is open, `NotificationService` revalidates the same TIM token every
`TIM_TOKEN_REVALIDATION_INTERVAL_MS`. If revalidation fails, the service emits a
final `session_expired` SSE event and closes the client connection.

### Private app

The private app listens on `API_PORT_PRIVATE` or `3001` when the variable is not
set. Its routes are prefixed with `/private`, except `/health`, which is excluded
from the global prefix.

The private notification endpoint is:

```http
POST /private/v1/notifications/events
```

Internal publishers post notification envelopes to this endpoint. The private
app validates the body and publishes accepted events to RabbitMQ.

| Recipient | `recipientUuid` | Routing key |
| --- | --- | --- |
| `GLOBAL` | Must be omitted | `global` |
| `CHAT` | UUID v4 | `channel.chat.<recipientUuid>` |
| `USER` | UUID or an Estonian identifier matching `^EE\d{11}$` | `channel.user.<normalizedUserUuid>` |

For `USER`, an Estonian identifier is normalized to the same deterministic UUID
v5 format used for authenticated USER subscriptions before the event is
published.

The private endpoint is also protected by TIM JWT authentication.

### Web Push

The public SSE endpoint optionally accepts a browser Push API subscription in
the following header:

```http
X-Buerokratt-Web-Push-Subscription: <base64url-encoded PushSubscription JSON>
```

The header is not required. When it is omitted, the SSE connection works
normally without registering Web Push. When present, the subscription is
registered for `GLOBAL`, all requested `CHAT` recipients, and the authenticated
`USER` recipient when available. Its lifetime is bounded by the authenticated
JWT `exp` claim.

Publishers request a push notification by adding an optional `webPush` object to
the private event body:

```json
{
  "eventUuid": "b0e97ac6-47ef-4bbf-83a6-cf01ebae5f3d",
  "recipient": "USER",
  "recipientUuid": "EE30303039914",
  "type": "new_notification",
  "payload": {},
  "webPush": {
    "title": "New notification",
    "body": "You have a new notification.",
    "ttl": 300
  }
}
```

`webPush.title` and `webPush.body` are required when `webPush` is present.
`webPush.ttl` is optional and controls the push provider retention time in
seconds.

The service consumes Web Push events through a dedicated durable RabbitMQ
queue. Delivery is recipient-based, and a Valkey delivery claim prevents the
same event from being sent more than once to the same subscription. Global and
USER subscription indexes expire with the JWT. CHAT registrations are removed
when their last SSE connection closes, with expiration as a fallback. Expired
sorted-set members are pruned when indexes are read. Provider responses `404`
and `410` remove the invalid subscription and its indexes.

### Reserved service event types

The service owns the following SSE event type keywords. They can be emitted by
the public SSE stream, but cannot be published through the private endpoint.
Private publish validation is case-insensitive after trimming whitespace.

| Type keyword | Description |
| --- | --- |
| `heartbeat` | Internal SSE keep-alive event emitted immediately after connection and then every 30 seconds while a client connection is open. |
| `session_expired` | Internal SSE event emitted before closing a client connection when TIM token revalidation fails. |

---

## Environment variables

The API loads `api/config/<NODE_ENV>.env` and also reads process environment
values. `NODE_ENV` defaults to `development` when it is not set.

| Variable | Required | Production example | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | Optional | `production` | Selects `api/config/<NODE_ENV>.env`; defaults to `development`. |
| `API_CORS_ORIGIN` | Required | `https://app.example.com,https://admin.example.com` | Comma-separated allowed browser origins; do not add spaces between values and avoid `*` in production. |
| `API_DOCUMENTATION_ENABLED` | Required | `false` | Enables Swagger at `/documentation` on each app. Enable it for production testing; otherwise keep it disabled. |
| `API_PORT_PUBLIC` | Optional | `3000` | Public API and SSE port; defaults to `3000`. |
| `API_PORT_PRIVATE` | Optional | `3001` | Private API port; defaults to `3001`. |
| `TIM_URL` | Required | `http://tim:8085` | Base URL of the TIM service, resolvable and reachable from the API container; must use `http` or `https`. |
| `TIM_JWT_COOKIE_NAMES` | Required | `chatJwt,customJwtCookie,customSmaxJwtCookie,userJwt` | Comma-separated JWT cookie names used for TIM authentication; the first name is used in Swagger cookie auth. |
| `TIM_TOKEN_REVALIDATION_INTERVAL_MS` | Required | `5000` | Interval, in milliseconds, for revalidating TIM tokens. |
| `RABBITMQ_URL` | Required | `amqps://user:password@rabbitmq.example:5671/vhost?heartbeat=30` | AMQP/AMQPS connection URL. Production Docker Compose uses its included RabbitMQ service by default; change the URL when using an external or managed instance. |
| `RABBITMQ_PREFIX` | Optional | `production` | Use `production` to isolate production RabbitMQ resources, or leave it empty when no prefix is needed. |
| `VALKEY_HOST` | Required | `valkey` | Valkey hostname used by the standalone GLIDE client; must be a non-empty string. |
| `VALKEY_PORT` | Required | `6379` | Valkey port; must be an integer from `1` through `65535`. |
| `VALKEY_USE_TLS` | Required | `true` | Controls TLS for the Valkey connection. Use `true` for external or managed production instances; use `false` only on a trusted private network where TLS is not configured. |
| `VALKEY_USERNAME` | Optional | `notifications` | Valkey ACL username. Supplying a username also requires a non-empty password. |
| `VALKEY_PASSWORD` | Optional | `<secret>` | Valkey password. Empty values are treated as unset. |
| `VALKEY_CONNECT_TIMEOUT_MS` | Required | `10000` | Valkey connection timeout in milliseconds; must be an integer of at least `1`. |
| `VALKEY_REQUEST_TIMEOUT_MS` | Required | `5000` | Valkey request timeout in milliseconds; must be an integer of at least `1`. |
| `WEB_PUSH_VAPID_SUBJECT` | Required | `mailto:notifications@example.com` | VAPID contact subject used to sign Web Push requests; must start with `mailto:` or `https://`. |
| `WEB_PUSH_VAPID_PUBLIC_KEY` | Required | `<vapid-public-key>` | Non-empty VAPID public key paired with `WEB_PUSH_VAPID_PRIVATE_KEY`. |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Required | `<vapid-private-key>` | Non-empty VAPID private key used by the server; keep it secret. |
| `WEB_PUSH_TTL_SECONDS` | Required | `86400` | Default Web Push provider retention time in seconds when an event does not specify `webPush.ttl`; must be an integer of at least `0`. |
| `WEB_PUSH_REQUEST_TIMEOUT_MS` | Required | `10000` | Timeout for each Web Push provider request in milliseconds; must be an integer of at least `1`. |
| `WEB_PUSH_CONCURRENCY` | Required | `20` | Maximum number of Web Push provider deliveries processed concurrently by one delivery operation; must be an integer of at least `1`. |

---

## Architectural ToDo: TIM token validation load

- `NotificationService` currently validates JWT tokens separately for each
  active session.
- Under higher load, this creates redundant validation traffic to TIM because
  each active session can trigger its own TIM request for token state that could
  be checked more efficiently in bulk.
- Define a cleaner token-state synchronization contract with TIM. Two options
  should be discussed:
  - notifications service sends the currently active session tokens to TIM in a
    single request and receives validation or blacklist status for each token;
  - TIM returns or publishes the set of blacklisted tokens, and notifications
    service matches them against active sessions.
- In both cases, `NotificationService` should treat TIM as the source of truth
  for token revocation. When an active session token is blacklisted, close the
  related client connection.

---

## Production deployment

### Prerequisites

The service requires:

- A container runtime or Kubernetes cluster capable of running `linux/amd64` images
- A reachable RabbitMQ instance
- A reachable TIM instance for JWT validation
- Two exposed HTTP ports:
  - `3000` — public API
  - `3001` — private API

Both APIs run in the same container process.

### Required environment variables

Production environment values are defined in `api/config/production.env` and
loaded by `api/docker-compose.yml`. Values declared directly in the Docker
Compose environment override values from the environment file.

The current `api/config/production.env` sets `TIM_URL=http://localhost:8085`.
The production Docker Compose configuration does not run TIM, so DevOps must
replace this value with the URL of a TIM service reachable from the API
container before deployment.

See [Environment variables](#environment-variables) for the complete
configuration reference and production examples.

Do not use `localhost` in `TIM_URL` or `RABBITMQ_URL` unless that dependency
runs inside the same container. In Docker Compose or Kubernetes, use the
dependency's service or DNS name.

Store RabbitMQ credentials in the deployment platform's secret manager. Do not
commit them to the repository.

### Production Docker Compose

The production Docker Compose configuration is `api/docker-compose.yml`. From
the `api` directory, build and start it with:

```sh
docker compose -f docker-compose.yml up --build -d
```

### Networking and ingress

Route public traffic only to port `3000`. Port `3001` contains private
endpoints and must only be reachable by trusted internal services.

### Post-deployment verification

1. Confirm that both `/health` endpoints return a successful response.
2. Confirm that the API logs show a successful RabbitMQ connection.
3. Confirm that a request authenticated with a valid TIM JWT succeeds.

### Deployment notes

- All replicas must use the same RabbitMQ exchange prefix for the same
  environment.
- Use different `RABBITMQ_PREFIX` values for development, staging, and
  production.
- RabbitMQ must be available during application startup.
- Graceful termination should allow existing SSE connections to close before
  the container is stopped.
- Production RabbitMQ should use authentication.

---
