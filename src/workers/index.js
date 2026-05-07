import 'dotenv/config';
import { connect, disconnect } from '../lib/db.js';
import logger from '../lib/logger.js';
import { validateEnv } from '../lib/envValidator.js';
import { closeRedis } from '../lib/queue/redis.js';
import { closeQueues, getQueue } from '../lib/queue/queues.js';
import { QUEUE_NAMES, JOB_NAMES } from '../lib/queue/queueNames.js';
import { wrap } from '../lib/queue/jobShapes.js';
import { createPushWorker } from './push.worker.js';
import { createEmailWorker } from './email.worker.js';
import { createFanoutWorker } from './fanout.worker.js';
import { createMaintenanceWorker } from './maintenance.worker.js';

/**
 * Worker process entrypoint. Behaviour controlled by env:
 *   WORKER_ROLES=push,email,fanout,maintenance   (default — see envValidator)
 *   WORKER_ROLES=all                              (shorthand for everything)
 *
 * The same factories are also called by the API process when
 * RUN_WORKERS_INPROCESS=true — see startInProcessWorkers().
 */

const ROLE_FACTORIES = {
  push: createPushWorker,
  email: createEmailWorker,
  fanout: createFanoutWorker,
  maintenance: createMaintenanceWorker,
};

const parseRoles = () => {
  const raw = (process.env.WORKER_ROLES || 'push,email,fanout,maintenance')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (raw.includes('all')) return Object.keys(ROLE_FACTORIES);

  const valid = [];
  for (const r of raw) {
    if (ROLE_FACTORIES[r]) valid.push(r);
    else logger.warn('Ignoring unknown worker role', { role: r });
  }
  return valid;
};

/**
 * Boot the requested worker set and return their handles. Workers are
 * connected to Redis lazily by BullMQ on the first job — no explicit ready
 * check needed here.
 */
export const startWorkers = (roles = parseRoles()) => {
  if (roles.length === 0) {
    logger.warn('No worker roles configured — process will idle');
    return [];
  }

  const workers = roles.map((role) => {
    const factory = ROLE_FACTORIES[role];
    const w = factory();
    logger.info('Worker started', { role });
    return { role, worker: w };
  });

  return workers;
};

/**
 * Schedule repeatable maintenance jobs. Idempotent — `upsertJobScheduler`
 * replaces any existing scheduler with the same id, so reboot-safe.
 */
export const scheduleMaintenanceJobs = async () => {
  const queue = getQueue(QUEUE_NAMES.MAINTENANCE);

  await queue.upsertJobScheduler(
    'token-cleanup-daily',
    { pattern: '0 3 * * *' }, // 03:00 daily
    { name: JOB_NAMES.MAINT_TOKEN_CLEANUP, data: wrap({}) }
  );

  await queue.upsertJobScheduler(
    'expired-notifs-daily',
    { pattern: '15 3 * * *' }, // 03:15 daily
    { name: JOB_NAMES.MAINT_EXPIRED_NOTIFS, data: wrap({}) }
  );

  await queue.upsertJobScheduler(
    'dlq-sweep-6h',
    { every: 6 * 60 * 60 * 1000 }, // every 6h
    { name: JOB_NAMES.MAINT_DLQ_SWEEP, data: wrap({}) }
  );

  logger.info('Maintenance schedulers upserted');
};

/**
 * Convenience for running workers inside the API process when
 * RUN_WORKERS_INPROCESS=true. Skips Mongo connect (the API already did it)
 * and skips its own shutdown wiring (the API owns shutdown).
 */
export const startInProcessWorkers = async () => {
  if (process.env.ENABLE_QUEUE !== 'true') {
    logger.info('In-process workers skipped — ENABLE_QUEUE is not true');
    return [];
  }
  if (process.env.RUN_WORKERS_INPROCESS !== 'true') return [];

  const workers = startWorkers();
  if (workers.some((w) => w.role === 'maintenance')) {
    await scheduleMaintenanceJobs();
  }
  return workers;
};

/**
 * Graceful shutdown — close workers first (drains in-flight jobs), then queues,
 * then Redis, then Mongo.
 */
const shutdown = async (workers) => {
  logger.info('Worker process shutting down');
  for (const { worker } of workers) {
    try { await worker.close(); } catch (e) { logger.warn('Worker close failed', { error: e.message }); }
  }
  await closeQueues();
  await closeRedis();
  await disconnect().catch((e) => logger.warn('Mongo disconnect failed', { error: e.message }));
  process.exit(0);
};

// Standalone process entrypoint (npm run worker)
const isStandalone = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
                    process.argv[1]?.endsWith('workers/index.js') ||
                    process.argv[1]?.endsWith('workers\\index.js');

if (isStandalone) {
  (async () => {
    try {
      validateEnv();
    } catch (err) {
      logger.error('Worker env validation failed', { error: err.message });
      process.exit(1);
    }

    if (process.env.ENABLE_QUEUE !== 'true') {
      logger.error('Worker started but ENABLE_QUEUE is not true. Exiting.');
      process.exit(1);
    }

    process.on('uncaughtException', (err) => {
      logger.error('Worker uncaught exception', { error: err.message, stack: err.stack });
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('Worker unhandled rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
      });
      process.exit(1);
    });

    await connect();
    const workers = startWorkers();

    if (workers.some((w) => w.role === 'maintenance')) {
      await scheduleMaintenanceJobs();
    }

    process.on('SIGTERM', () => shutdown(workers));
    process.on('SIGINT', () => shutdown(workers));

    logger.info('Worker process ready', {
      roles: workers.map((w) => w.role),
      pid: process.pid,
    });
  })();
}
