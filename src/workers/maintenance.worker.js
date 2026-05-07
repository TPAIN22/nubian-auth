import { Worker, UnrecoverableError } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../lib/queue/queueNames.js';
import { assertVersion } from '../lib/queue/jobShapes.js';
import { getWorkerRedis } from '../lib/queue/redis.js';
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
          // Step 8 — left intentionally as a stub for now.
          logger.info('DLQ sweep stub invoked (step 8 placeholder)');
          return { swept: 0 };
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
