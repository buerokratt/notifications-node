export const INVALID_WEB_PUSH_SUBSCRIPTION_HEADER_MESSAGE = 'Invalid Web Push subscription header';

export const WEB_PUSH_SUBSCRIPTION_HEADER = 'X-Buerokratt-Web-Push-Subscription';

/**
 * Atomically stores the Push subscription, extends its expiry, and adds it to the global subscription index.
 *
 * KEYS[1] subscription data key
 * KEYS[2] global subscription IDs sorted set
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
redis.call('ZADD', KEYS[2], 'GT', expiresAt, ARGV[2])

local indexExpiresAt = redis.call('EXPIRETIME', KEYS[2])
if indexExpiresAt < expiresAt then
  redis.call('EXPIREAT', KEYS[2], expiresAt)
end

return 1
`;

/**
 * Atomically registers one SSE connection for a subscription target while maintaining both target indexes.
 *
 * KEYS[1] active connection IDs sorted set
 * KEYS[2] subscription recipient UUIDs set
 * KEYS[3] recipient subscription IDs sorted set
 *
 * ARGV[1] connection ID
 * ARGV[2] connection expiration Unix time in seconds
 * ARGV[3] current Unix time in seconds
 * ARGV[4] recipient UUID
 * ARGV[5] subscription ID
 */
export const REGISTER_CONNECTION_TARGET_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[3])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('SADD', KEYS[2], ARGV[4])
redis.call('ZADD', KEYS[3], 'GT', ARGV[2], ARGV[5])

local connectionExpiresAt = redis.call('EXPIRETIME', KEYS[1])
if connectionExpiresAt < tonumber(ARGV[2]) then
  redis.call('EXPIREAT', KEYS[1], ARGV[2])
end

local recipientsExpireAt = redis.call('EXPIRETIME', KEYS[2])
if recipientsExpireAt < tonumber(ARGV[2]) then
  redis.call('EXPIREAT', KEYS[2], ARGV[2])
end

local indexExpiresAt = redis.call('EXPIRETIME', KEYS[3])
if indexExpiresAt < tonumber(ARGV[2]) then
  redis.call('EXPIREAT', KEYS[3], ARGV[2])
end

return 1
`;

/**
 * Atomically removes an SSE connection, prunes expired connections, and removes both target indexes when none remain.
 *
 * KEYS[1] active connection IDs sorted set
 * KEYS[2] subscription recipient UUIDs set
 * KEYS[3] recipient subscription IDs sorted set
 *
 * ARGV[1] connection ID, or an empty string when only pruning
 * ARGV[2] current Unix time in seconds
 * ARGV[3] recipient UUID
 * ARGV[4] subscription ID
 *
 * Returns 1 when active connections remain, otherwise 0.
 */
export const CLEAN_UP_CONNECTION_TARGET_SCRIPT = `
if ARGV[1] ~= '' then
  redis.call('ZREM', KEYS[1], ARGV[1])
end

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])

if redis.call('ZCARD', KEYS[1]) > 0 then
  return 1
end

redis.call('SREM', KEYS[2], ARGV[3])
redis.call('ZREM', KEYS[3], ARGV[4])
redis.call('DEL', KEYS[1])

return 0
`;

/**
 * Atomically registers a subscription for one USER, replacing its previous USER association.
 * Re-registering the same USER retains the later JWT expiration.
 *
 * KEYS[1] subscription USER UUID
 * KEYS[2] new USER subscription IDs sorted set
 *
 * ARGV[1] subscription ID
 * ARGV[2] new USER UUID
 * ARGV[3] JWT expiration Unix time in seconds
 * ARGV[4] USER index key prefix
 */
export const REGISTER_USER_TARGET_SCRIPT = `
local previousRecipientUuid = redis.call('GET', KEYS[1])
local expiresAt = tonumber(ARGV[3])

if previousRecipientUuid and previousRecipientUuid ~= ARGV[2] then
  local previousRecipientKey = ARGV[4] .. previousRecipientUuid .. ':subscriptions'
  redis.call('ZREM', previousRecipientKey, ARGV[1])
elseif previousRecipientUuid == ARGV[2] then
  local currentExpiresAt = redis.call('EXPIRETIME', KEYS[1])
  if currentExpiresAt > expiresAt then
    expiresAt = currentExpiresAt
  end
end

redis.call('SET', KEYS[1], ARGV[2])
redis.call('EXPIREAT', KEYS[1], expiresAt)
redis.call('ZADD', KEYS[2], 'GT', expiresAt, ARGV[1])

local indexExpiresAt = redis.call('EXPIRETIME', KEYS[2])
if indexExpiresAt < expiresAt then
  redis.call('EXPIREAT', KEYS[2], expiresAt)
end

return 1
`;

const WEB_PUSH_VALKEY_PREFIX = 'webpush';
export const WEB_PUSH_USER_INDEX_PREFIX = `${WEB_PUSH_VALKEY_PREFIX}:user:`;

export const WEB_PUSH_VALKEY_KEYS = {
  subscription: {
    allIds: `${WEB_PUSH_VALKEY_PREFIX}:subscriptions`,
    data: (subscriptionId: string): string => `${WEB_PUSH_VALKEY_PREFIX}:subscription:${subscriptionId}:data`,
    chatUuids: (subscriptionId: string): string => `${WEB_PUSH_VALKEY_PREFIX}:subscription:${subscriptionId}:chats`,
    userUuid: (subscriptionId: string): string => `${WEB_PUSH_VALKEY_PREFIX}:subscription:${subscriptionId}:user`,
  },
  recipient: {
    chatSubscriptionIds: (chatUuid: string): string => `${WEB_PUSH_VALKEY_PREFIX}:chat:${chatUuid}:subscriptions`,
    userSubscriptionIds: (userUuid: string): string => `${WEB_PUSH_VALKEY_PREFIX}:user:${userUuid}:subscriptions`,
  },
  connection: {
    chatIds: (subscriptionId: string, chatUuid: string): string =>
      `${WEB_PUSH_VALKEY_PREFIX}:subscription:${subscriptionId}:chat:${chatUuid}:connections`,
  },
  delivery: {
    claim: (eventUuid: string, subscriptionId: string): string =>
      `${WEB_PUSH_VALKEY_PREFIX}:delivery:${eventUuid}:${subscriptionId}`,
  },
} as const;
export const WEB_PUSH_DELIVERY_CLAIM_TTL_SECONDS_MIN = 60;
