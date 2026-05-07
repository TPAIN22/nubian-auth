import { Worker, UnrecoverableError } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../lib/queue/queueNames.js';
import { assertVersion } from '../lib/queue/jobShapes.js';
import { getWorkerRedis } from '../lib/queue/redis.js';
import { deliverEmail } from '../services/channels/email.channel.js';
import logger from '../lib/logger.js';

/**
 * Email worker — consumes the `nubian:notif:email` queue and dispatches on
 * job.name to the right Resend template.
 */
export const createEmailWorker = () => {
  const concurrency = parseInt(process.env.EMAIL_WORKER_CONCURRENCY || '5', 10);
  const prefix = process.env.REDIS_PREFIX || undefined;

  const worker = new Worker(
    QUEUE_NAMES.EMAIL,
    async (job) => {
      assertVersion(job);

      const knownEmailJobs = new Set([
        JOB_NAMES.EMAIL_WELCOME,
        JOB_NAMES.EMAIL_ORDER,
        JOB_NAMES.EMAIL_MERCHANT_SUSPENSION,
        JOB_NAMES.EMAIL_MERCHANT_UNSUSPENSION,
      ]);

      if (!knownEmailJobs.has(job.name)) {
        throw new UnrecoverableError(`Unknown email job: ${job.name}`);
      }

      try {
        return await deliverEmail(job.name, job.data);
      } catch (err) {
        if (err.unrecoverable) {
          throw new UnrecoverableError(err.message);
        }
        throw err;
      }
    },
    { connection: getWorkerRedis(), prefix, concurrency }
  );

  worker.on('completed', (job) => {
    logger.info('Email job completed', { jobId: job.id, jobName: job.name });
  });
  worker.on('failed', (job, err) => {
    logger.error('Email job failed', {
      jobId: job?.id,
      jobName: job?.name,
      attempts: job?.attemptsMade,
      maxAttempts: job?.opts?.attempts,
      error: err?.message,
      unrecoverable: !!err?.unrecoverable,
    });
  });
  worker.on('error', (err) => {
    logger.error('Email worker error', { error: err.message });
  });

  return worker;
};
