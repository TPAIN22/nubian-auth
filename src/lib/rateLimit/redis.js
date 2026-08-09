/**
 * Redis connection dedicated to rate limiting and the IP denylist.
 *
 * Deliberately NOT the queue producer connection from lib/queue/redis.js. That
 * one is tuned for enqueueing jobs: `commandTimeout` there is 5s, which is the
 * right budget for a background dispatch but catastrophic here — this client is
 * on the hot path of *every* API request, so a stalled Redis would add 5s to
 * every single one. This connection trades that for a tight timeout plus a
 * circuit breaker (below), because a rate limiter that is slow is worse than a
 * rate limiter that is temporarily degraded.
 *
 * Connection budget: this adds ~1 client on top of the queue's ~14 (see
 * CLAUDE.md). Both the limiter store and the denylist share this single client.
 */
import IORedis from 'ioredis';
import logger from '../logger.js';

let client = null;

/**
 * Whether Redis-backed limiting is active.
 *
 * `auto` (the default) turns it on whenever REDIS_URL is configured, so a
 * deployment that already runs the notification queue gets shared, restart-proof
 * rate limiting with no extra config. `memory` forces the old per-process
 * behaviour (useful for local dev without Redis); `redis` forces it on so a
 * misconfigured production deploy fails loudly instead of silently degrading to
 * per-instance counters.
 */
export const rateLimitRedisEnabled = () => {
  const mode = (process.env.RATE_LIMIT_STORE || 'auto').toLowerCase();
  if (mode === 'memory') return false;
  if (mode === 'redis') return true;
  return Boolean(process.env.REDIS_URL);
};

/** Namespace so one Redis can host staging + prod (mirrors the queue prefix). */
export const keyPrefix = () => `${process.env.REDIS_PREFIX || ''}nubian_sec:`;

export const getRateLimitRedis = () => {
  if (client) return client;

  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  client = new IORedis(url, {
    // Fail fast and never buffer: a command issued while Redis is unreachable
    // must reject immediately so the caller can fall back to the memory store.
    // With an offline queue it would instead sit buffered and resolve minutes
    // later, long after the request it belonged to was answered.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: Number(process.env.RATE_LIMIT_REDIS_TIMEOUT_MS || 300),
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000),
    retryStrategy: (times) => Math.min(times * 200, 30000),
    connectionName: `${process.env.REDIS_CLIENT_NAME || 'nubian-api'}-ratelimit`,
  });

  // A permanently unreachable Redis retries forever and emits an error per
  // attempt. Log the first, then at most one a minute with a suppressed count.
  let lastLoggedAt = 0;
  let suppressed = 0;
  client.on('error', (err) => {
    const now = Date.now();
    if (now - lastLoggedAt < 60_000) {
      suppressed++;
      return;
    }
    logger.error('Rate-limit Redis error', {
      error: err.message,
      ...(suppressed ? { suppressed } : {}),
    });
    lastLoggedAt = now;
    suppressed = 0;
  });
  client.on('ready', () => logger.info('Rate-limit Redis ready'));

  return client;
};

/**
 * Circuit breaker.
 *
 * Without it, a Redis outage costs every request a full `commandTimeout` before
 * falling back. After OPEN_AFTER consecutive failures we stop calling Redis
 * entirely for COOLDOWN_MS and serve from the in-memory fallback, so the outage
 * costs a handful of slow requests per cooldown window instead of all of them.
 */
const OPEN_AFTER = Number(process.env.RATE_LIMIT_BREAKER_FAILURES || 5);
const COOLDOWN_MS = Number(process.env.RATE_LIMIT_BREAKER_COOLDOWN_MS || 30_000);

const breaker = { failures: 0, openUntil: 0 };

export const breakerOpen = () => Date.now() < breaker.openUntil;

export const recordRedisSuccess = () => {
  if (breaker.failures !== 0) breaker.failures = 0;
};

export const recordRedisFailure = (err) => {
  breaker.failures++;
  if (breaker.failures >= OPEN_AFTER && !breakerOpen()) {
    breaker.openUntil = Date.now() + COOLDOWN_MS;
    logger.error('Rate-limit Redis circuit opened — falling back to in-memory limiting', {
      failures: breaker.failures,
      cooldownMs: COOLDOWN_MS,
      error: err?.message,
    });
  }
};

/** Exposed for the admin status endpoint. */
export const breakerState = () => ({
  open: breakerOpen(),
  failures: breaker.failures,
  openUntil: breaker.openUntil || null,
});

export const closeRateLimitRedis = async () => {
  if (!client) return;
  const c = client;
  client = null;
  await c.quit().catch((e) => logger.warn('Rate-limit Redis quit failed', { error: e.message }));
};
