import IORedis from 'ioredis';
import logger from '../logger.js';

// BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
// on the underlying ioredis connection — these defaults are wrong for blocking
// commands like BRPOPLPUSH which workers depend on. See:
// https://docs.bullmq.io/guide/connections

let connection = null;
let subscriberConnection = null;

const buildOptions = () => {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  return {
    url,
    options: {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // Reconnect with capped exponential backoff. Returning a number tells
      // ioredis to retry after that many ms; returning null stops retries.
      // The cap is deliberately high: a brief blip still reconnects within a
      // second or two, but a Redis that is gone for good (deleted instance,
      // bad URL) settles into one attempt per 30s instead of flooding logs.
      retryStrategy: (times) => Math.min(times * 200, 30000),
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000),
      // Tag the client so it shows up identifiable in `CLIENT LIST`.
      connectionName: process.env.REDIS_CLIENT_NAME || 'nubian-api',
    },
  };
};

/**
 * A connection that can never succeed (deleted instance, wrong host) retries
 * forever, and every attempt emits an error + a reconnecting warning. That is
 * thousands of near-identical lines a day. Log the first occurrence of each
 * message immediately, then at most once a minute, with a count of what was
 * suppressed — enough to see the outage without drowning everything else.
 */
const LOG_THROTTLE_MS = 60_000;
const makeThrottledLogger = () => {
  const state = new Map(); // message → { lastLoggedAt, suppressed }
  return (level, message, meta) => {
    const now = Date.now();
    const entry = state.get(message) || { lastLoggedAt: 0, suppressed: 0 };
    if (now - entry.lastLoggedAt < LOG_THROTTLE_MS) {
      entry.suppressed++;
      state.set(message, entry);
      return;
    }
    logger[level](message, entry.suppressed ? { ...meta, suppressed: entry.suppressed } : meta);
    state.set(message, { lastLoggedAt: now, suppressed: 0 });
  };
};

/**
 * Returns the shared Redis connection used for publishing jobs and reading
 * queue state. Lazy-initialized — calling this before ENABLE_QUEUE=true is fine
 * as long as nothing actually issues a command.
 */
export const getRedis = () => {
  if (connection) return connection;

  const { url, options } = buildOptions();
  // Producer connection: fail fast, never buffer.
  //
  // `maxRetriesPerRequest: null` (required by BullMQ) means ioredis never gives
  // up on a command. Combined with the default offline queue, a command issued
  // while Redis is unreachable sits buffered *forever* — the promise neither
  // resolves nor rejects. That turned `queue.add()` inside an HTTP handler into
  // an infinite hang (the client eventually aborts with ECONNABORTED) and meant
  // the "Redis down → sync fallback" path could never trigger.
  //
  // `enableOfflineQueue: false` makes those commands reject immediately and,
  // crucially, guarantees they never execute later — so a caller that falls
  // back to a sync dispatch can't be double-delivered by a late-landing job.
  // `commandTimeout` covers the other half: socket connected but server stalled.
  connection = new IORedis(url, {
    ...options,
    enableOfflineQueue: false,
    commandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT_MS || 5000),
  });

  connection.on('connect', () => {
    logger.info('Redis connecting', { url: redactUrl(url) });
  });
  connection.on('ready', () => {
    logger.info('Redis ready', { url: redactUrl(url) });
  });
  const throttled = makeThrottledLogger();
  connection.on('error', (err) => {
    throttled('error', 'Redis error', { error: err.message });
  });
  connection.on('end', () => {
    logger.warn('Redis connection closed');
  });
  connection.on('reconnecting', (delay) => {
    throttled('warn', 'Redis reconnecting', { delayMs: delay });
  });

  return connection;
};

/**
 * BullMQ Workers need a dedicated connection because they hold blocking calls
 * open. Sharing the publisher connection with a Worker is a foot-gun. Workers
 * call this to get their own client.
 */
export const getWorkerRedis = () => {
  if (subscriberConnection) return subscriberConnection;
  const { url, options } = buildOptions();
  // Deliberately keeps the offline queue and has no commandTimeout: workers
  // hold blocking commands (BRPOPLPUSH) open for minutes at a time, so the
  // fail-fast settings applied to the producer connection would kill them.
  subscriberConnection = new IORedis(url, {
    ...options,
    connectionName: `${options.connectionName}-worker`,
  });
  const throttled = makeThrottledLogger();
  subscriberConnection.on('error', (err) => {
    throttled('error', 'Redis worker connection error', { error: err.message });
  });
  return subscriberConnection;
};

/**
 * Close all Redis connections. Called from graceful-shutdown hooks.
 */
export const closeRedis = async () => {
  const closures = [];
  if (connection) {
    closures.push(connection.quit().catch((e) => logger.warn('Redis quit failed', { error: e.message })));
    connection = null;
  }
  if (subscriberConnection) {
    closures.push(subscriberConnection.quit().catch((e) => logger.warn('Redis worker quit failed', { error: e.message })));
    subscriberConnection = null;
  }
  await Promise.all(closures);
};

/**
 * Strip credentials from a redis URL before logging.
 */
const redactUrl = (url) => {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = u.username ? '***' : '';
    return u.toString();
  } catch {
    return 'redis://<unparseable>';
  }
};

/**
 * Lightweight check used by health probes. Avoids exposing connection internals.
 */
export const pingRedis = async () => {
  try {
    const client = getRedis();
    const reply = await client.ping();
    return reply === 'PONG';
  } catch (err) {
    logger.warn('Redis ping failed', { error: err.message });
    return false;
  }
};
