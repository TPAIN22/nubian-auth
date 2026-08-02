import { Queue, QueueEvents } from 'bullmq';
import { getRedis } from './redis.js';
import { QUEUE_NAMES, ALL_QUEUE_NAMES } from './queueNames.js';
import logger from '../logger.js';

/**
 * Per-queue default job options. Tuned per channel — see the design doc.
 *
 *   attempts        — total attempts including the first
 *   backoff         — exponential, BullMQ caps internal jitter automatically
 *   removeOnComplete — keep recent successes for debugging, drop old ones
 *   removeOnFail     — keep failures so the DLQ tools can inspect them
 */
const QUEUE_DEFAULTS = {
  [QUEUE_NAMES.PUSH]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600, count: 1000 }, // 1h or last 1k
    removeOnFail: { age: 7 * 24 * 3600, count: 5000 }, // 7d
  },
  [QUEUE_NAMES.EMAIL]: {
    attempts: 6,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 14 * 24 * 3600, count: 5000 },
  },
  [QUEUE_NAMES.SMS]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 14 * 24 * 3600, count: 2000 },
  },
  [QUEUE_NAMES.FANOUT]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { age: 3600, count: 200 },
    removeOnFail: { age: 14 * 24 * 3600, count: 1000 },
  },
  [QUEUE_NAMES.MAINTENANCE]: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: { age: 24 * 3600, count: 200 },
    removeOnFail: { age: 30 * 24 * 3600, count: 1000 },
  },
};

const queues = new Map();
const queueEvents = new Map();

const queuePrefix = () => process.env.REDIS_PREFIX || undefined;

/**
 * Lazy-create a Queue instance. Cached so repeated callers share one client.
 */
export const getQueue = (name) => {
  if (!ALL_QUEUE_NAMES.includes(name)) {
    throw new Error(`Unknown queue: ${name}`);
  }
  const cached = queues.get(name);
  if (cached) return cached;

  const queue = new Queue(name, {
    connection: getRedis(),
    prefix: queuePrefix(),
    defaultJobOptions: QUEUE_DEFAULTS[name],
  });
  queues.set(name, queue);
  logger.info('Queue initialised', { queue: name });
  return queue;
};

/**
 * Lazy-create a QueueEvents instance. Used by admin endpoints to subscribe
 * to job state changes — not needed by the producers in the hot path.
 */
export const getQueueEvents = (name) => {
  const cached = queueEvents.get(name);
  if (cached) return cached;
  const qe = new QueueEvents(name, {
    connection: getRedis(),
    prefix: queuePrefix(),
  });
  queueEvents.set(name, qe);
  return qe;
};

/**
 * Return the default job options for a given queue. Workers reuse this so
 * retries on requeue stay consistent with the producer's policy.
 */
export const getQueueDefaults = (name) => QUEUE_DEFAULTS[name];

export class EnqueueTimeoutError extends Error {
  constructor(queueName, timeoutMs) {
    super(`Enqueue to "${queueName}" timed out after ${timeoutMs}ms`);
    this.name = 'EnqueueTimeoutError';
    this.code = 'ENQUEUE_TIMEOUT';
  }
}

const enqueueTimeoutMs = () => Number(process.env.QUEUE_ENQUEUE_TIMEOUT_MS || 8000);

/**
 * Was the job possibly written to Redis despite the error?
 *
 * A caller that wants to fall back to a synchronous dispatch needs to know
 * this: re-sending a job that actually landed means double delivery.
 *
 *   connection not ready  → BullMQ was still awaiting `waitUntilReady()` and
 *                           never issued a command. Definitively not written.
 *   command timed out     → the command was on the wire. Unknown.
 *   anything else         → a real rejection from Redis (or ioredis refusing
 *                           to buffer). Not written.
 */
const mayHaveLanded = (err) => {
  if (getRedis().status !== 'ready') return false;
  return err.code === 'ENQUEUE_TIMEOUT' || /timed out/i.test(err.message || '');
};

/**
 * Convenience: enqueue a job with sensible per-job overrides applied on top
 * of the queue defaults. Rejects (never hangs) if Redis is unreachable —
 * callers must catch (notificationService.enqueueOrFallback handles that) and
 * may consult `err.mayHaveLanded` before re-dispatching by another route.
 *
 * @param {string} queueName - one of QUEUE_NAMES
 * @param {string} jobName   - one of JOB_NAMES
 * @param {object} payload   - job data, must already be wrap()'d
 * @param {object} [opts]    - per-job options: jobId, delay, priority
 */
export const enqueue = async (queueName, jobName, payload, opts = {}) => {
  const queue = getQueue(queueName);
  // BullMQ rejects custom jobIds containing ':' (it collides with internal
  // Redis key namespacing). Sanitize defensively so callers can build ids
  // from arbitrary strings (titles, recipient ids, etc.) without crashing.
  const safeOpts = opts.jobId
    ? { ...opts, jobId: String(opts.jobId).replace(/:/g, '-') }
    : opts;

  // Backstop so a producer in an HTTP handler can never hang indefinitely.
  // The fail-fast client options in redis.js are not sufficient on their own:
  // `Queue.add` awaits `waitUntilReady()` first, so with Redis unreachable it
  // parks on the connection promise and no command is ever issued to reject.
  //
  // Every rejection carries `err.mayHaveLanded` so callers can decide whether
  // a synchronous fallback is safe or would risk double delivery.
  const timeoutMs = enqueueTimeoutMs();
  let timer;
  try {
    return await Promise.race([
      queue.add(jobName, payload, safeOpts),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new EnqueueTimeoutError(queueName, timeoutMs)), timeoutMs);
      }),
    ]);
  } catch (err) {
    err.mayHaveLanded = mayHaveLanded(err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Close all queue clients gracefully. Called from shutdown hooks.
 */
export const closeQueues = async () => {
  const closures = [];
  for (const q of queues.values()) {
    closures.push(q.close().catch((e) => logger.warn('Queue close failed', { error: e.message })));
  }
  for (const qe of queueEvents.values()) {
    closures.push(qe.close().catch((e) => logger.warn('QueueEvents close failed', { error: e.message })));
  }
  queues.clear();
  queueEvents.clear();
  await Promise.all(closures);
};
