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
      retryStrategy: (times) => Math.min(times * 200, 5000),
      // Tag the client so it shows up identifiable in `CLIENT LIST`.
      connectionName: process.env.REDIS_CLIENT_NAME || 'nubian-api',
    },
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
  connection = new IORedis(url, options);

  connection.on('connect', () => {
    logger.info('Redis connecting', { url: redactUrl(url) });
  });
  connection.on('ready', () => {
    logger.info('Redis ready', { url: redactUrl(url) });
  });
  connection.on('error', (err) => {
    logger.error('Redis error', { error: err.message });
  });
  connection.on('end', () => {
    logger.warn('Redis connection closed');
  });
  connection.on('reconnecting', (delay) => {
    logger.warn('Redis reconnecting', { delayMs: delay });
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
  subscriberConnection = new IORedis(url, {
    ...options,
    connectionName: `${options.connectionName}-worker`,
  });
  subscriberConnection.on('error', (err) => {
    logger.error('Redis worker connection error', { error: err.message });
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
