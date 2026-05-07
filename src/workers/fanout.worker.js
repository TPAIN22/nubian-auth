import { Worker, UnrecoverableError } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../lib/queue/queueNames.js';
import { assertVersion, wrap } from '../lib/queue/jobShapes.js';
import { getWorkerRedis } from '../lib/queue/redis.js';
import { enqueue } from '../lib/queue/queues.js';
import logger from '../lib/logger.js';

/**
 * Fanout worker — splits broadcast/marketing jobs into per-recipient send
 * jobs without holding any large list in memory.
 *
 * Phase-1 implementation is intentionally minimal: it logs the request and
 * acknowledges. The actual recipient-streaming logic lands in Step 6 of the
 * migration plan, once the per-channel push cutover has been validated.
 */
export const createFanoutWorker = () => {
  const concurrency = parseInt(process.env.FANOUT_WORKER_CONCURRENCY || '3', 10);
  const prefix = process.env.REDIS_PREFIX || undefined;

  const worker = new Worker(
    QUEUE_NAMES.FANOUT,
    async (job) => {
      assertVersion(job);

      switch (job.name) {
        case JOB_NAMES.FANOUT_BROADCAST:
        case JOB_NAMES.FANOUT_MARKETING:
        case JOB_NAMES.FANOUT_SEGMENT:
          // Placeholder until step 6. We log and exit cleanly so jobs don't
          // pile up in 'active' state during scaffolding.
          logger.info('Fanout job received (phase-1 stub)', {
            jobId: job.id,
            jobName: job.name,
            target: job.data?.target,
          });
          return { acknowledged: true, processed: 0 };
        default:
          throw new UnrecoverableError(`Unknown fanout job: ${job.name}`);
      }
    },
    { connection: getWorkerRedis(), prefix, concurrency }
  );

  worker.on('failed', (job, err) => {
    logger.error('Fanout job failed', {
      jobId: job?.id,
      jobName: job?.name,
      attempts: job?.attemptsMade,
      error: err?.message,
    });
  });
  worker.on('error', (err) => {
    logger.error('Fanout worker error', { error: err.message });
  });

  return worker;
};

// Re-exported so the future fanout implementation can enqueue child jobs
// without re-importing wrap()/enqueue() — keeps the import surface stable.
export const __fanoutHelpers = { wrap, enqueue };
