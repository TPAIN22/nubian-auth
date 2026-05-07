import { Worker, UnrecoverableError } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../lib/queue/queueNames.js';
import { assertVersion } from '../lib/queue/jobShapes.js';
import { getWorkerRedis } from '../lib/queue/redis.js';
import { deliverPushNotification } from '../services/channels/push.channel.js';
import logger from '../lib/logger.js';

/**
 * Push worker — consumes the `nubian:notif:push` queue.
 *
 * Concurrency 10: Expo calls are I/O-bound (mostly waiting on the HTTPS
 * round-trip). Tune via PUSH_WORKER_CONCURRENCY if needed.
 */
export const createPushWorker = () => {
  const concurrency = parseInt(process.env.PUSH_WORKER_CONCURRENCY || '10', 10);
  const prefix = process.env.REDIS_PREFIX || undefined;

  const worker = new Worker(
    QUEUE_NAMES.PUSH,
    async (job) => {
      assertVersion(job);

      switch (job.name) {
        case JOB_NAMES.PUSH_SEND: {
          const { notificationId } = job.data;
          if (!notificationId) {
            throw new UnrecoverableError('Missing notificationId in push.send payload');
          }
          return deliverPushNotification(notificationId);
        }
        default:
          throw new UnrecoverableError(`Unknown job name on push queue: ${job.name}`);
      }
    },
    { connection: getWorkerRedis(), prefix, concurrency }
  );

  attachWorkerLogging(worker, QUEUE_NAMES.PUSH);
  return worker;
};

/**
 * Standard worker logging + error mapping. Maps `err.unrecoverable === true`
 * to BullMQ's UnrecoverableError so retries are skipped.
 */
const attachWorkerLogging = (worker, queueName) => {
  worker.on('active', (job) => {
    logger.debug('Job started', { queue: queueName, jobId: job.id, jobName: job.name, attempts: job.attemptsMade + 1 });
  });

  worker.on('completed', (job, result) => {
    logger.info('Job completed', { queue: queueName, jobId: job.id, jobName: job.name, result: summarizeResult(result) });
  });

  worker.on('failed', (job, err) => {
    const finalAttempt = !job || job.attemptsMade >= (job.opts?.attempts || 1);
    logger.error('Job failed', {
      queue: queueName,
      jobId: job?.id,
      jobName: job?.name,
      attempts: job?.attemptsMade,
      maxAttempts: job?.opts?.attempts,
      error: err?.message,
      unrecoverable: !!err?.unrecoverable,
      willRetry: !finalAttempt && !err?.unrecoverable,
    });
  });

  worker.on('error', (err) => {
    logger.error('Worker error', { queue: queueName, error: err.message });
  });
};

const summarizeResult = (result) => {
  if (!result || typeof result !== 'object') return result;
  // Don't dump full token lists into logs.
  const { tokensSent, tokensFailed, status } = result;
  return { tokensSent, tokensFailed, status };
};
