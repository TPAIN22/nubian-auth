import { Worker, UnrecoverableError } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../lib/queue/queueNames.js';
import { assertVersion } from '../lib/queue/jobShapes.js';
import { getRedis, getWorkerRedis } from '../lib/queue/redis.js';
import { getQueue } from '../lib/queue/queues.js';
import logger from '../lib/logger.js';
import PushToken from '../models/pushToken.model.js';
import Notification from '../models/notification.model.js';

/**
 * Maintenance worker — runs repeatable housekeeping jobs:
 *  - token-cleanup:   deactivates tokens that haven't been used in 90 days
 *  - expired-notifs:  hard-deletes Notification rows past expiresAt + 30d
 *  - dlq-sweep:       (placeholder for step 8) re-queues recoverable failures
 *
 * Repeatable jobs are scheduled by the entrypoint (workers/index.js) via
 * Queue.upsertJobScheduler so the schedule is idempotent across restarts.
 */
export const createMaintenanceWorker = () => {
  const concurrency = 1; // sequential — these jobs touch shared state
  const prefix = process.env.REDIS_PREFIX || undefined;

  const worker = new Worker(
    QUEUE_NAMES.MAINTENANCE,
    async (job) => {
      assertVersion(job);

      switch (job.name) {
        case JOB_NAMES.MAINT_TOKEN_CLEANUP:
          return runTokenCleanup();
        case JOB_NAMES.MAINT_EXPIRED_NOTIFS:
          return runExpiredNotifs();
        case JOB_NAMES.MAINT_DLQ_SWEEP:
          return runDlqSweep();
        default:
          throw new UnrecoverableError(`Unknown maintenance job: ${job.name}`);
      }
    },
    { connection: getWorkerRedis(), prefix, concurrency }
  );

  worker.on('completed', (job, result) => {
    logger.info('Maintenance job completed', { jobName: job.name, result });
  });
  worker.on('failed', (job, err) => {
    logger.error('Maintenance job failed', { jobName: job?.name, error: err?.message });
  });

  return worker;
};

const runTokenCleanup = async () => {
  const result = await PushToken.cleanupExpiredTokens();
  logger.info('Token cleanup ran', { matched: result?.matchedCount, modified: result?.modifiedCount });
  return { matched: result?.matchedCount || 0, modified: result?.modifiedCount || 0 };
};

const runExpiredNotifs = async () => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await Notification.deleteMany({
    expiresAt: { $exists: true, $ne: null, $lt: cutoff },
  });
  logger.info('Expired notifications deleted', { deleted: result?.deletedCount });
  return { deleted: result?.deletedCount || 0 };
};

// Queues whose failed sets the sweeper retries. Maintenance is excluded —
// retrying our own failures could loop, and `removeOnFail` keeps the set
// bounded anyway.
const DLQ_SWEEP_QUEUES = [
  QUEUE_NAMES.PUSH,
  QUEUE_NAMES.EMAIL,
  QUEUE_NAMES.SMS,
  QUEUE_NAMES.FANOUT,
];

// Don't sweep something that just failed — give humans a chance to look first.
const SWEEP_GRACE_MS = 30 * 60 * 1000;
// Don't waste budget reviving ancient failures — let `drain` clean those up.
const SWEEP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Cap how many retries one run issues, so a stuck queue doesn't monopolise
// the maintenance worker.
const SWEEP_BUDGET_PER_RUN = 200;
const SWEEP_PAGE_SIZE = 50;
// "Already swept" set lifetime — a failure swept once in this window won't
// be retried again, even if it fails again.
const SWEEP_SET_TTL_SEC = 14 * 24 * 3600;

const sweptKey = (queue) => `nubian:dlq:swept:${queue}`;

/**
 * One-shot retry of recently-failed jobs across notification queues.
 *
 * Idempotency: each retried job.id is stored in a per-queue Redis set with a
 * 14-day TTL, so a job is swept at most once. `job.retry()` reuses the same
 * job.id, so even if the retried job fails again it'll match the set and be
 * skipped on the next sweep.
 */
const runDlqSweep = async () => {
  const redis = getRedis();
  const now = Date.now();
  const summary = {};

  for (const queueName of DLQ_SWEEP_QUEUES) {
    const queue = getQueue(queueName);
    const stats = { retried: 0, skippedSwept: 0, skippedAge: 0, skippedExpired: 0, scanned: 0 };

    pageLoop: for (let offset = 0; ; offset += SWEEP_PAGE_SIZE) {
      const jobs = await queue.getFailed(offset, offset + SWEEP_PAGE_SIZE - 1);
      if (!jobs.length) break;

      for (const job of jobs) {
        if (stats.retried >= SWEEP_BUDGET_PER_RUN) break pageLoop;
        stats.scanned++;

        const finishedOn = job.finishedOn || job.timestamp;
        if (!finishedOn) continue;
        const age = now - finishedOn;
        if (age < SWEEP_GRACE_MS) continue;
        if (age > SWEEP_MAX_AGE_MS) {
          stats.skippedAge++;
          continue;
        }

        const setKey = sweptKey(queueName);
        const already = await redis.sismember(setKey, String(job.id));
        if (already === 1) {
          stats.skippedSwept++;
          continue;
        }

        // For push.send jobs, only retry if the underlying notification still
        // makes sense to deliver — otherwise mark swept so we never see it again.
        if (queueName === QUEUE_NAMES.PUSH && job.name === JOB_NAMES.PUSH_SEND) {
          const id = job.data?.notificationId;
          const doc = id
            ? await Notification.findById(id).select('expiresAt').lean()
            : null;
          if (!doc || (doc.expiresAt && doc.expiresAt.getTime() < now)) {
            await redis.sadd(setKey, String(job.id));
            await redis.expire(setKey, SWEEP_SET_TTL_SEC);
            stats.skippedExpired++;
            continue;
          }
        }

        try {
          await job.retry();
          await redis.sadd(setKey, String(job.id));
          await redis.expire(setKey, SWEEP_SET_TTL_SEC);
          stats.retried++;
        } catch (err) {
          logger.warn('DLQ sweep retry failed', {
            queue: queueName,
            jobId: job.id,
            error: err.message,
          });
        }
      }
    }

    summary[queueName] = stats;
  }

  logger.info('DLQ sweep complete', summary);
  return summary;
};
