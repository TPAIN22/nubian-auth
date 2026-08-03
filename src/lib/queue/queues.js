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

export class QueueTimeoutError extends Error {
  constructor(queueName, timeoutMs) {
    super(`Redis operation on "${queueName}" timed out after ${timeoutMs}ms`);
    this.name = 'QueueTimeoutError';
    this.code = 'QUEUE_TIMEOUT';
  }
}

const queueTimeoutMs = () => Number(process.env.QUEUE_OP_TIMEOUT_MS || 8000);

/**
 * Was the operation possibly applied in Redis despite the error?
 *
 * A caller that wants to fall back to a synchronous dispatch needs to know
 * this: re-sending a job that actually landed means double delivery.
 *
 *   connection not ready  → BullMQ was still awaiting `waitUntilReady()` and
 *                           never issued a command. Definitively not applied.
 *   command timed out     → the command was on the wire. Unknown.
 *   anything else         → a real rejection from Redis (or ioredis refusing
 *                           to buffer). Not applied.
 */
const mayHaveLanded = (err) => {
  if (getRedis().status !== 'ready') return false;
  return err.code === 'QUEUE_TIMEOUT' || /timed out/i.test(err.message || '');
};

/**
 * Run a queue operation under a hard timeout so it can never hang.
 *
 * The fail-fast client options in redis.js are not sufficient on their own:
 * every BullMQ queue method awaits `waitUntilReady()` first, so with Redis
 * unreachable it parks on the connection promise and no command is ever issued
 * to reject. Without this wrapper the caller's own try/catch is unreachable and
 * the HTTP handler hangs until the client gives up.
 *
 * Rejections carry `err.mayHaveLanded` so callers can decide whether a
 * fallback path is safe or would risk double delivery.
 *
 * @param {string}   queueName - one of QUEUE_NAMES
 * @param {Function} fn        - receives the Queue, returns a promise
 * @param {number}   [timeoutMs]
 */
export const withQueue = async (queueName, fn, timeoutMs = queueTimeoutMs()) => {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(getQueue(queueName))),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new QueueTimeoutError(queueName, timeoutMs)), timeoutMs);
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
  return withQueue(queueName, (queue) => queue.add(jobName, payload, sanitizeOpts(opts)));
};

/**
 * BullMQ rejects custom jobIds containing ':' (it collides with internal Redis
 * key namespacing). Sanitize defensively so callers can build ids from
 * arbitrary strings — titles, dedup keys carrying JSON metadata, ISO
 * timestamps — without crashing.
 *
 * Exported so every enqueue path shares one rule. Calling `queue.add` /
 * `queue.addBulk` directly skips this and will throw on the first colon.
 */
export const sanitizeJobId = (jobId) => String(jobId).replace(/:/g, '-');

const sanitizeOpts = (opts = {}) =>
  opts.jobId ? { ...opts, jobId: sanitizeJobId(opts.jobId) } : opts;

/**
 * Bulk sibling of `enqueue`. Applies the same jobId sanitizing and the same
 * hang protection — a raw `queue.addBulk()` has neither, and one bad jobId
 * rejects the entire batch (BullMQ validates every job before writing any).
 *
 * The timeout scales with batch size: a 1000-job bulk is a long Redis pipeline
 * and should not be judged against the single-add budget.
 *
 * @param {string} queueName - one of QUEUE_NAMES
 * @param {Array<{name: string, data: object, opts?: object}>} jobs
 */
export const enqueueBulk = async (queueName, jobs) => {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];

  const safeJobs = jobs.map((job) => ({ ...job, opts: sanitizeOpts(job.opts) }));
  const timeoutMs = Math.min(Math.max(queueTimeoutMs(), jobs.length * 20), 60_000);

  return withQueue(queueName, (queue) => queue.addBulk(safeJobs), timeoutMs);
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
