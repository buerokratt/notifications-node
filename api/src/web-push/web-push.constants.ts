export const INVALID_WEB_PUSH_SUBSCRIPTION_HEADER_MESSAGE = 'Invalid Web Push subscription header';

export const WEB_PUSH_SUBSCRIPTION_HEADER = 'X-Buerokratt-Web-Push-Subscription';

/**
 * Atomically stores the Push subscription, extends its expiry, and adds it to the global subscription index.
 *
 * KEYS[1] subscription data key
 * KEYS[2] global subscription IDs set
 *
 * ARGV[1] serialized Push subscription
 * ARGV[2] subscription ID
 * ARGV[3] expiration Unix time in seconds
 */
export const REGISTER_GLOBAL_SUBSCRIPTION_SCRIPT = `
local expiresAt = tonumber(ARGV[3])
local currentExpiresAt = redis.call('EXPIRETIME', KEYS[1])

if currentExpiresAt > expiresAt then
  expiresAt = currentExpiresAt
end

redis.call('SET', KEYS[1], ARGV[1])
redis.call('EXPIREAT', KEYS[1], expiresAt)
redis.call('SADD', KEYS[2], ARGV[2])

return 1
`;

/**
 * Atomically registers one SSE connection for a subscription and chat while maintaining both chat indexes.
 *
 * KEYS[1] active connection IDs sorted set
 * KEYS[2] subscription chat UUIDs set
 * KEYS[3] chat subscription IDs set
 *
 * ARGV[1] connection ID
 * ARGV[2] connection expiration Unix time in seconds
 * ARGV[3] current Unix time in seconds
 * ARGV[4] chat UUID
 * ARGV[5] subscription ID
 */
export const REGISTER_CHAT_CONNECTION_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[3])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('SADD', KEYS[2], ARGV[4])
redis.call('SADD', KEYS[3], ARGV[5])

local connectionExpiresAt = redis.call('EXPIRETIME', KEYS[1])
if connectionExpiresAt < tonumber(ARGV[2]) then
  redis.call('EXPIREAT', KEYS[1], ARGV[2])
end

local chatsExpireAt = redis.call('EXPIRETIME', KEYS[2])
if chatsExpireAt < tonumber(ARGV[2]) then
  redis.call('EXPIREAT', KEYS[2], ARGV[2])
end

return 1
`;

/**
 * Atomically removes an SSE connection, prunes expired connections, and removes both chat indexes when none remain.
 *
 * KEYS[1] active connection IDs sorted set
 * KEYS[2] subscription chat UUIDs set
 * KEYS[3] chat subscription IDs set
 *
 * ARGV[1] connection ID, or an empty string when only pruning
 * ARGV[2] current Unix time in seconds
 * ARGV[3] chat UUID
 * ARGV[4] subscription ID
 *
 * Returns 1 when active connections remain, otherwise 0.
 */
export const CLEAN_UP_CHAT_CONNECTION_SCRIPT = `
if ARGV[1] ~= '' then
  redis.call('ZREM', KEYS[1], ARGV[1])
end

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])

if redis.call('ZCARD', KEYS[1]) > 0 then
  return 1
end

redis.call('SREM', KEYS[2], ARGV[3])
redis.call('SREM', KEYS[3], ARGV[4])
redis.call('DEL', KEYS[1])

return 0
`;

const WEB_PUSH_VALKEY_PREFIX = 'webpush';

export const WEB_PUSH_VALKEY_KEYS = {
  allSubscriptionIds: `${WEB_PUSH_VALKEY_PREFIX}:subscriptions`,
  chatSubscriptionIds: (chatUuid: string): string => `${WEB_PUSH_VALKEY_PREFIX}:chat:${chatUuid}:subscriptions`,
  deliveryClaim: (eventUuid: string, subscriptionId: string): string =>
    `${WEB_PUSH_VALKEY_PREFIX}:delivery:${eventUuid}:${subscriptionId}`,
  subscriptionChatConnectionIds: (subscriptionId: string, chatUuid: string): string =>
    `${WEB_PUSH_VALKEY_PREFIX}:subscription:${subscriptionId}:chat:${chatUuid}:connections`,
  subscriptionChatUuids: (subscriptionId: string): string =>
    `${WEB_PUSH_VALKEY_PREFIX}:subscription:${subscriptionId}:chats`,
  subscriptionData: (subscriptionId: string): string => `${WEB_PUSH_VALKEY_PREFIX}:subscription:${subscriptionId}:data`,
} as const;
export const WEB_PUSH_DELIVERY_CLAIM_TTL_SECONDS_MIN = 60;
