export const LIFECYCLE_EVENTS = {
  pollFailed: 'lifecycle.poll.failed',
  callbackRetryScheduled: 'lifecycle.callback.retry-scheduled',
  callbackFailed: 'lifecycle.callback.failed',
  callbackMaxAttemptsExceeded: 'lifecycle.callback.max-attempts-exceeded',
  callbackSucceeded: 'lifecycle.callback.succeeded',
  unsupportedAction: 'lifecycle.action.unsupported',
} as const satisfies Record<string, string>;

export const LIFECYCLE_REASONS = {
  unsupportedActionType: 'unsupported-action-type',
  invalidScheduleMember: 'invalid-schedule-member',
} as const satisfies Record<string, string>;

export const LIFECYCLE_STATUS = {
  action: {
    pending: 'pending',
    claimed: 'claimed',
    processing: 'processing',
    retryWait: 'retry-wait',
    completed: 'completed',
    failed: 'failed',
  },
  result: {
    stale: 'stale',
    rescheduled: 'rescheduled',
    terminate: 'terminate',
    retryScheduled: 'retry-scheduled',
    failed: 'failed',
    completed: 'completed',
  },
} as const satisfies Record<string, Record<string, string>>;

export const LIFECYCLE_SCHEDULE_KEY = 'lifecycle:schedule';
export const LIFECYCLE_ACTION_KEY_PREFIX = 'lifecycle:action:';
export const LOGOUT_ACTION_TYPE = 'csa-last-connection-disconnected';
export const LIFECYCLE_SCHEDULE_SCAN_LIMIT_MULTIPLIER = 3;
export const LIFECYCLE_COMPLETED_ACTION_TTL_MS = 5 * 60 * 1000;
export const LIFECYCLE_RETRY_BASE_DELAY_MS = 1_000;
export const LIFECYCLE_RETRY_MAX_DELAY_MS = 60_000;
export const LIFECYCLE_CALLBACK_TIMEOUT_MS = 5_000;

export const LIFECYCLE_SCOPE_TYPE = {
  Backoffice: 'user:backoffice',
} as const;

/**
 * Registers or renews a backoffice presence lease and updates the
 * scope's single lifecycle action. A new cycle token is used only when a
 * cycle starts; heartbeats and extra connections preserve the current token.
 * Processing and retry-wait actions are irreversible and are not changed.
 *
 * Valkey KEYS, in order:
 * 1. Presence sorted set for the backoffice scope.
 * 2. Shared lifecycle schedule sorted set.
 * 3. Lifecycle action hash for the scope.
 *
 * Valkey ARGV, in order:
 * 1. Server-generated connection ID.
 * 2. Presence lease duration in seconds.
 * 3. Lifecycle action type.
 * 4. Lifecycle scope type.
 * 5. Scope UUID.
 * 6. Candidate cycle token, used only when a new cycle starts.
 * 7. Grace period in seconds.
 * 8. Prebuilt schedule member for the scope.
 * 9. JWT ID associated with the SSE connection.
 * 10. Required backoffice user ID code from the authenticated JWT.
 *
 * Uses Valkey server time. Presence expires at its latest lease; action dueAt
 * is latest lease plus grace. Returns the computed dueAt in Unix milliseconds.
 */
export const REGISTER_CONNECTION_SCRIPT = `
-- Keys
local presenceKey = KEYS[1]
local scheduleKey = KEYS[2]
local actionKey = KEYS[3]

-- Arguments
local connectionId = ARGV[1]
local presenceLeaseSeconds = tonumber(ARGV[2])
local actionType = ARGV[3]
local scopeType = ARGV[4]
local scopeId = ARGV[5]
local cycleToken = ARGV[6]
local gracePeriodSeconds = tonumber(ARGV[7])
local scheduleMember = ARGV[8]
local jti = ARGV[9]
local userIdCode = ARGV[10]

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local leaseExpiresAt = now + presenceLeaseSeconds * 1000

redis.call('ZREMRANGEBYSCORE', presenceKey, '-inf', now)
local hadPresence = redis.call('ZCARD', presenceKey) > 0
redis.call('ZADD', presenceKey, leaseExpiresAt, connectionId)
local latestLease = redis.call('ZRANGE', presenceKey, -1, -1, 'WITHSCORES')
redis.call('PEXPIREAT', presenceKey, tonumber(latestLease[2]))

local dueAt = tonumber(latestLease[2]) + gracePeriodSeconds * 1000
local status = redis.call('HGET', actionKey, 'status')
if status == '${LIFECYCLE_STATUS.action.processing}'
  or status == '${LIFECYCLE_STATUS.action.retryWait}' then
  redis.call('HSET', actionKey, 'userIdCode', userIdCode)
  redis.call('HDEL', actionKey, 'actionId')
  return dueAt
end

local newCycle = not status
  or status == '${LIFECYCLE_STATUS.action.completed}'
  or status == '${LIFECYCLE_STATUS.action.failed}'
  or (not hadPresence and (status == '${LIFECYCLE_STATUS.action.pending}'
    or status == '${LIFECYCLE_STATUS.action.claimed}'))

if newCycle then
  redis.call('DEL', actionKey)
  redis.call('HSET', actionKey,
    'type', actionType,
    'scopeType', scopeType,
    'scopeId', scopeId,
    'cycleToken', cycleToken,
    'attempt', '0',
    'createdAt', now)
end

redis.call('HSET', actionKey, 'jti', jti)
redis.call('HSET', actionKey, 'userIdCode', userIdCode)

redis.call('HSET', actionKey,
  'status', '${LIFECYCLE_STATUS.action.pending}',
  'dueAt', dueAt)
redis.call('HDEL', actionKey, 'actionId', 'claimToken', 'claimedBy', 'claimLeaseUntil', 'processingLeaseUntil', 'retryAt')
redis.call('ZADD', scheduleKey, dueAt, scheduleMember)

return dueAt
`;

/**
 * Removes one connection and updates the lifecycle action. Remaining leases
 * schedule latest expiry plus grace; no remaining leases start grace now.
 * Repeated removal is a no-op. Processing and retry-wait remain irreversible.
 *
 * Valkey KEYS, in order:
 * 1. Presence sorted set for the backoffice scope.
 * 2. Shared lifecycle schedule sorted set.
 * 3. Lifecycle action hash for the scope.
 *
 * Valkey ARGV, in order:
 * 1. Server-generated connection ID to remove.
 * 2. Grace period in seconds.
 * 3. Lifecycle action type.
 * 4. Lifecycle scope type.
 * 5. Scope UUID.
 * 6. Candidate cycle token, used if a new cycle must be created.
 * 7. Prebuilt schedule member for the scope.
 *
 * Uses Valkey server time; returns dueAt or zero when presence did not change.
 */
export const REMOVE_CONNECTION_SCRIPT = `
-- Keys
local presenceKey = KEYS[1]
local scheduleKey = KEYS[2]
local actionKey = KEYS[3]

-- Arguments
local connectionId = ARGV[1]
local gracePeriodSeconds = tonumber(ARGV[2])
local actionType = ARGV[3]
local scopeType = ARGV[4]
local scopeId = ARGV[5]
local cycleToken = ARGV[6]
local scheduleMember = ARGV[7]

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

local removed = redis.call('ZREM', presenceKey, connectionId)
local pruned = redis.call('ZREMRANGEBYSCORE', presenceKey, '-inf', now)
local changedPresence = removed > 0 or pruned > 0
local latestLease = redis.call('ZRANGE', presenceKey, -1, -1, 'WITHSCORES')
local dueAt = now + gracePeriodSeconds * 1000

if latestLease[2] then
  dueAt = tonumber(latestLease[2]) + gracePeriodSeconds * 1000
  redis.call('PEXPIREAT', presenceKey, tonumber(latestLease[2]))
else
  redis.call('DEL', presenceKey)
end

if not changedPresence then
  return 0
end

local status = redis.call('HGET', actionKey, 'status')
if status == '${LIFECYCLE_STATUS.action.processing}'
  or status == '${LIFECYCLE_STATUS.action.retryWait}' then
  redis.call('HDEL', actionKey, 'actionId')
  return dueAt
end

local newCycle = not status
  or status == '${LIFECYCLE_STATUS.action.completed}'
  or status == '${LIFECYCLE_STATUS.action.failed}'

if newCycle then
  redis.call('DEL', actionKey)
  redis.call('HSET', actionKey,
    'type', actionType,
    'scopeType', scopeType,
    'scopeId', scopeId,
    'cycleToken', cycleToken,
    'attempt', '0',
    'createdAt', now)
end

redis.call('HSET', actionKey,
  'status', '${LIFECYCLE_STATUS.action.pending}',
  'dueAt', dueAt)
redis.call('HDEL', actionKey, 'actionId', 'claimToken', 'claimedBy', 'claimLeaseUntil', 'processingLeaseUntil', 'retryAt')
redis.call('ZADD', scheduleKey, dueAt, scheduleMember)

return dueAt
`;

/**
 * Atomically claims exactly one schedule candidate discovered by application
 * code. A candidate is only a hint: this script revalidates its score against
 * Valkey server time, applies claim/recovery transitions, and fences the
 * previous worker with a fresh claim token. An unexpected action type is
 * atomically marked failed and removed from the schedule before it is claimed.
 *
 * Valkey KEYS, in order:
 * 1. Shared lifecycle schedule sorted set.
 * 2. Lifecycle action hash for the candidate scope.
 *
 * Valkey ARGV, in order:
 * 1. Stable schedule member for the candidate scope.
 * 2. Shared action lease duration in seconds.
 * 3. New worker claim token.
 * 4. Worker replica ID.
 * 5. Expected action type for the scope.
 *
 * Returns one JSON action, a failed result for an unexpected action type, or
 * an empty string when the candidate is stale, no longer due, or not claimable.
 */
export const CLAIM_ACTION_SCRIPT = `
-- Keys
local scheduleKey = KEYS[1]
local actionKey = KEYS[2]

-- Arguments
local scheduleMember = ARGV[1]
local actionLeaseSeconds = tonumber(ARGV[2])
local claimToken = ARGV[3]
local claimedBy = ARGV[4]
local expectedActionType = ARGV[5]

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local scheduleScore = redis.call('ZSCORE', scheduleKey, scheduleMember)
if not scheduleScore or tonumber(scheduleScore) > now then
  return ''
end

local actionType = redis.call('HGET', actionKey, 'type')
local status = redis.call('HGET', actionKey, 'status')
local cycleToken = redis.call('HGET', actionKey, 'cycleToken')
if not actionType or not status or not cycleToken then
  redis.call('ZREM', scheduleKey, scheduleMember)
  return ''
end

if actionType ~= expectedActionType then
  redis.call('ZREM', scheduleKey, scheduleMember)
  redis.call('HSET', actionKey,
    'status', '${LIFECYCLE_STATUS.action.failed}',
    'failedAt', now,
    'failureReason', '${LIFECYCLE_REASONS.unsupportedActionType}')
  redis.call('HDEL', actionKey, 'actionId', 'claimToken', 'claimedBy', 'claimLeaseUntil', 'processingLeaseUntil', 'retryAt')
  return cjson.encode({
    status = '${LIFECYCLE_STATUS.result.failed}',
    actionType = actionType
  })
end

local nextStatus = status
local leaseUntil = now + actionLeaseSeconds * 1000
if status == '${LIFECYCLE_STATUS.action.pending}'
  or status == '${LIFECYCLE_STATUS.action.claimed}' then
  nextStatus = '${LIFECYCLE_STATUS.action.claimed}'
  redis.call('HDEL', actionKey, 'processingLeaseUntil', 'retryAt')
  redis.call('HSET', actionKey, 'claimLeaseUntil', leaseUntil)
elseif status == '${LIFECYCLE_STATUS.action.processing}'
  or status == '${LIFECYCLE_STATUS.action.retryWait}' then
  nextStatus = '${LIFECYCLE_STATUS.action.processing}'
  redis.call('HDEL', actionKey, 'claimLeaseUntil', 'retryAt')
  redis.call('HSET', actionKey, 'processingLeaseUntil', leaseUntil)
else
  redis.call('ZREM', scheduleKey, scheduleMember)
  return ''
end

redis.call('HSET', actionKey,
  'status', nextStatus,
  'claimToken', claimToken,
  'claimedBy', claimedBy)
redis.call('HDEL', actionKey, 'actionId')
redis.call('ZADD', scheduleKey, leaseUntil, scheduleMember)

return cjson.encode({
  type = actionType,
  cycleToken = cycleToken,
  status = nextStatus,
  claimToken = claimToken,
  attempt = tonumber(redis.call('HGET', actionKey, 'attempt') or '0'),
  dueAt = tonumber(redis.call('HGET', actionKey, 'dueAt') or '0'),
  jti = redis.call('HGET', actionKey, 'jti'),
  userIdCode = redis.call('HGET', actionKey, 'userIdCode')
})
`;

/**
 * Performs the final atomic presence check for a claimed action. With active
 * presence it reschedules to latest lease plus grace. With no presence it
 * crosses the irreversible boundary and starts a fresh action lease.
 *
 * Valkey KEYS, in order:
 * 1. Presence sorted set for the action scope.
 * 2. Shared lifecycle schedule sorted set.
 * 3. Lifecycle action hash for the scope.
 *
 * Valkey ARGV, in order:
 * 1. Stable schedule member for the scope.
 * 2. Cycle token to validate the lifecycle generation.
 * 3. Claim token to validate worker ownership.
 * 4. Grace period in seconds.
 * 5. Shared action lease duration in seconds.
 *
 * Returns stale, rescheduled, or terminate with action metadata.
 */
export const RECONCILE_ACTION_SCRIPT = `
-- Keys
local presenceKey = KEYS[1]
local scheduleKey = KEYS[2]
local actionKey = KEYS[3]

-- Arguments
local scheduleMember = ARGV[1]
local cycleToken = ARGV[2]
local claimToken = ARGV[3]
local gracePeriodSeconds = tonumber(ARGV[4])
local actionLeaseSeconds = tonumber(ARGV[5])

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

if redis.call('HGET', actionKey, 'cycleToken') ~= cycleToken
  or redis.call('HGET', actionKey, 'status') ~= '${LIFECYCLE_STATUS.action.claimed}'
  or redis.call('HGET', actionKey, 'claimToken') ~= claimToken then
  return cjson.encode({ status = '${LIFECYCLE_STATUS.result.stale}' })
end

redis.call('ZREMRANGEBYSCORE', presenceKey, '-inf', now)
local latestLease = redis.call('ZRANGE', presenceKey, -1, -1, 'WITHSCORES')

if latestLease[2] then
  local dueAt = tonumber(latestLease[2]) + gracePeriodSeconds * 1000
  redis.call('HSET', actionKey,
    'status', '${LIFECYCLE_STATUS.action.pending}',
    'dueAt', dueAt)
  redis.call('HDEL', actionKey, 'claimToken', 'claimedBy', 'claimLeaseUntil', 'processingLeaseUntil')
  redis.call('ZADD', scheduleKey, dueAt, scheduleMember)
  return cjson.encode({
    status = '${LIFECYCLE_STATUS.result.rescheduled}',
    dueAt = dueAt
  })
end

redis.call('DEL', presenceKey)
local processingLeaseUntil = now + actionLeaseSeconds * 1000
redis.call('HSET', actionKey,
  'status', '${LIFECYCLE_STATUS.action.processing}',
  'processingStartedAt', now,
  'processingLeaseUntil', processingLeaseUntil)
redis.call('HDEL', actionKey, 'claimLeaseUntil')
redis.call('ZADD', scheduleKey, processingLeaseUntil, scheduleMember)

return cjson.encode({
  status = '${LIFECYCLE_STATUS.result.terminate}',
  attempt = tonumber(redis.call('HGET', actionKey, 'attempt') or '0'),
  dueAt = tonumber(redis.call('HGET', actionKey, 'dueAt') or '0')
})
`;

/**
 * Completes an irreversible action only when cycle and worker tokens still
 * match. The terminal hash is retained briefly for inspection, then expires.
 *
 * Valkey KEYS, in order:
 * 1. Shared lifecycle schedule sorted set.
 * 2. Lifecycle action hash for the scope.
 *
 * Valkey ARGV, in order:
 * 1. Stable schedule member for the scope.
 * 2. Cycle token to validate the lifecycle generation.
 * 3. Claim token to validate worker ownership.
 *
 * Returns completed or stale.
 */
export const COMPLETE_ACTION_SCRIPT = `
-- Keys
local scheduleKey = KEYS[1]
local actionKey = KEYS[2]

-- Arguments
local scheduleMember = ARGV[1]
local cycleToken = ARGV[2]
local claimToken = ARGV[3]

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

if redis.call('HGET', actionKey, 'status') ~= '${LIFECYCLE_STATUS.action.processing}'
  or redis.call('HGET', actionKey, 'cycleToken') ~= cycleToken
  or redis.call('HGET', actionKey, 'claimToken') ~= claimToken then
  return cjson.encode({ status = '${LIFECYCLE_STATUS.result.stale}' })
end

redis.call('ZREM', scheduleKey, scheduleMember)
redis.call('HSET', actionKey,
  'status', '${LIFECYCLE_STATUS.action.completed}',
  'completedAt', now)
redis.call('HDEL', actionKey, 'actionId', 'claimToken', 'claimedBy', 'claimLeaseUntil', 'processingLeaseUntil', 'retryAt', 'userIdCode')
redis.call('PEXPIRE', actionKey, ${LIFECYCLE_COMPLETED_ACTION_TTL_MS})

return cjson.encode({ status = '${LIFECYCLE_STATUS.result.completed}' })
`;

/**
 * Records one failed lifecycle callback. Application policy decides whether
 * to retry; this script atomically increments the attempt and applies either
 * RETRY_WAIT or FAILED while validating current worker ownership.
 *
 * Valkey KEYS, in order:
 * 1. Shared lifecycle schedule sorted set.
 * 2. Lifecycle action hash for the scope.
 *
 * Valkey ARGV, in order:
 * 1. Stable schedule member for the scope.
 * 2. Cycle token to validate the lifecycle generation.
 * 3. Claim token to validate worker ownership.
 * 4. Application retry decision (`1` to retry, `0` to fail terminally).
 * 5. Retry delay in milliseconds; ignored when the application chose terminal failure.
 *
 * Returns stale, retry-scheduled, or failed.
 */
export const RECORD_ACTION_FAILURE_SCRIPT = `
-- Keys
local scheduleKey = KEYS[1]
local actionKey = KEYS[2]

-- Arguments
local scheduleMember = ARGV[1]
local cycleToken = ARGV[2]
local claimToken = ARGV[3]
local shouldRetry = ARGV[4] == '1'
local retryDelayMs = tonumber(ARGV[5])

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

if redis.call('HGET', actionKey, 'status') ~= '${LIFECYCLE_STATUS.action.processing}'
  or redis.call('HGET', actionKey, 'cycleToken') ~= cycleToken
  or redis.call('HGET', actionKey, 'claimToken') ~= claimToken then
  return cjson.encode({ status = '${LIFECYCLE_STATUS.result.stale}' })
end

local attempt = tonumber(redis.call('HGET', actionKey, 'attempt') or '0') + 1
if not shouldRetry then
  redis.call('ZREM', scheduleKey, scheduleMember)
  redis.call('HSET', actionKey,
    'status', '${LIFECYCLE_STATUS.action.failed}',
    'attempt', attempt,
    'failedAt', now)
  redis.call('HDEL', actionKey, 'actionId', 'claimToken', 'claimedBy', 'claimLeaseUntil', 'processingLeaseUntil', 'retryAt', 'userIdCode')
  return cjson.encode({
    status = '${LIFECYCLE_STATUS.result.failed}',
    attempt = attempt
  })
end

local retryAt = now + retryDelayMs
redis.call('HSET', actionKey,
  'status', '${LIFECYCLE_STATUS.action.retryWait}',
  'attempt', attempt,
  'retryAt', retryAt)
redis.call('HDEL', actionKey, 'actionId', 'claimToken', 'claimedBy', 'claimLeaseUntil', 'processingLeaseUntil')
redis.call('ZADD', scheduleKey, retryAt, scheduleMember)

return cjson.encode({
  status = '${LIFECYCLE_STATUS.result.retryScheduled}',
  attempt = attempt,
  retryAt = retryAt
})
`;
