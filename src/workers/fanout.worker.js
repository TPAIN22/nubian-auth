import { Worker, UnrecoverableError } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../lib/queue/queueNames.js';
import { assertVersion, wrap } from '../lib/queue/jobShapes.js';
import { getWorkerRedis } from '../lib/queue/redis.js';
import { getQueue } from '../lib/queue/queues.js';
import notificationService from '../services/notificationService.js';
import User from '../models/user.model.js';
import Merchant from '../models/merchant.model.js';
import logger from '../lib/logger.js';

const DEFAULT_CHUNK_SIZE = 1000;

/**
 * Fanout worker — splits broadcast/marketing jobs into per-recipient
 * push.send jobs without holding the entire recipient list in memory. For
 * large targets it streams via a Mongo cursor and bulk-inserts notifications
 * + bulk-enqueues child jobs in chunks.
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
          return handleBroadcast(job);
        case JOB_NAMES.FANOUT_MARKETING:
          return handleMarketing(job);
        case JOB_NAMES.FANOUT_SEGMENT:
          // Segment targeting goes through MARKETING with a `{ segment }` payload.
          return handleMarketing(job);
        default:
          throw new UnrecoverableError(`Unknown fanout job: ${job.name}`);
      }
    },
    { connection: getWorkerRedis(), prefix, concurrency }
  );

  worker.on('completed', (job, result) => {
    logger.info('Fanout job completed', { jobId: job.id, jobName: job.name, ...result });
  });
  worker.on('failed', (job, err) => {
    logger.error('Fanout job failed', {
      jobId: job?.id,
      jobName: job?.name,
      attempts: job?.attemptsMade,
      error: err?.message,
      unrecoverable: !!err?.unrecoverable,
    });
  });
  worker.on('error', (err) => {
    logger.error('Fanout worker error', { error: err.message });
  });

  return worker;
};

/**
 * FANOUT_BROADCAST: query users / merchants based on `target`, persist + emit
 * push jobs in chunks.
 */
const handleBroadcast = async (job) => {
  const {
    type,
    title,
    body,
    deepLink,
    metadata,
    target,
    chunkSize = DEFAULT_CHUNK_SIZE,
  } = job.data;

  if (!type || !title || !body || !target) {
    throw new UnrecoverableError(
      `FANOUT_BROADCAST missing required fields (type/title/body/target)`
    );
  }

  const notificationData = { type, title, body, deepLink, metadata };
  const result = { users: 0, merchants: 0, pushJobsEnqueued: 0 };

  if (target === 'users' || target === 'all') {
    const stats = await streamAndDispatch({
      Model: User,
      query: {},
      recipientType: 'user',
      notificationData,
      chunkSize,
    });
    result.users = stats.persisted;
    result.pushJobsEnqueued += stats.enqueued;
  }

  if (target === 'merchants' || target === 'all') {
    const stats = await streamAndDispatch({
      Model: Merchant,
      query: { status: 'approved' },
      recipientType: 'merchant',
      notificationData,
      chunkSize,
    });
    result.merchants = stats.persisted;
    result.pushJobsEnqueued += stats.enqueued;
  }

  return result;
};

/**
 * FANOUT_MARKETING: handle the three target shapes
 *   - null         → broadcast to all users
 *   - string[]     → specific user IDs
 *   - { segment }  → segment-resolved user IDs (segment logic is a stub today)
 */
const handleMarketing = async (job) => {
  const {
    type,
    title,
    body,
    deepLink,
    metadata,
    targetRecipients,
    chunkSize = DEFAULT_CHUNK_SIZE,
  } = job.data;

  if (!type || !title || !body) {
    throw new UnrecoverableError(`FANOUT_MARKETING missing required fields`);
  }

  const notificationData = { type, title, body, deepLink, metadata };

  // Array of explicit recipient IDs — chunk in-memory, no cursor needed.
  if (Array.isArray(targetRecipients)) {
    let persisted = 0;
    let enqueued = 0;
    for (let i = 0; i < targetRecipients.length; i += chunkSize) {
      const chunk = targetRecipients.slice(i, i + chunkSize);
      const stats = await persistAndEnqueueChunk({
        notificationData,
        recipientIds: chunk,
        recipientType: 'user',
      });
      persisted += stats.persisted;
      enqueued += stats.enqueued;
    }
    return { users: persisted, pushJobsEnqueued: enqueued };
  }

  // Segmented targeting — segment filters are placeholders today, so this
  // resolves to all users (matching the legacy `sendToSegmentedUsers` path).
  if (
    targetRecipients &&
    typeof targetRecipients === 'object' &&
    targetRecipients.segment
  ) {
    const stats = await streamAndDispatch({
      Model: User,
      query: buildSegmentQuery(targetRecipients.segment),
      recipientType: 'user',
      notificationData,
      chunkSize,
    });
    return { users: stats.persisted, pushJobsEnqueued: stats.enqueued };
  }

  // Default: broadcast to all users.
  const stats = await streamAndDispatch({
    Model: User,
    query: {},
    recipientType: 'user',
    notificationData,
    chunkSize,
  });
  return { users: stats.persisted, pushJobsEnqueued: stats.enqueued };
};

/**
 * Stream a recipient cursor, batching IDs into chunks of `chunkSize`. Each
 * chunk is persisted + dispatched before the next one is read, keeping memory
 * bounded regardless of recipient count.
 */
const streamAndDispatch = async ({
  Model,
  query,
  recipientType,
  notificationData,
  chunkSize,
}) => {
  const cursor = Model.find(query).select('_id').lean().cursor({ batchSize: chunkSize });
  let chunk = [];
  let persisted = 0;
  let enqueued = 0;

  for await (const doc of cursor) {
    chunk.push(doc._id);
    if (chunk.length >= chunkSize) {
      const stats = await persistAndEnqueueChunk({
        notificationData,
        recipientIds: chunk,
        recipientType,
      });
      persisted += stats.persisted;
      enqueued += stats.enqueued;
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    const stats = await persistAndEnqueueChunk({
      notificationData,
      recipientIds: chunk,
      recipientType,
    });
    persisted += stats.persisted;
    enqueued += stats.enqueued;
  }

  return { persisted, enqueued };
};

/**
 * One chunk: bulk-insert notification docs, then bulk-enqueue push.send jobs
 * for the docs that actually persisted.
 */
const persistAndEnqueueChunk = async ({
  notificationData,
  recipientIds,
  recipientType,
}) => {
  const inserted = await notificationService.batchPersistQueuedNotifications(
    notificationData,
    recipientIds,
    recipientType
  );

  if (inserted.length === 0) {
    return { persisted: 0, enqueued: 0 };
  }

  const pushQueue = getQueue(QUEUE_NAMES.PUSH);
  const jobs = inserted.map((n) => ({
    name: JOB_NAMES.PUSH_SEND,
    data: wrap({ notificationId: n._id.toString() }),
    opts: {
      // Use the dedup key as the BullMQ jobId so retries / accidental
      // double-fanouts don't double-deliver to the same recipient.
      jobId: `push:${n.deduplicationKey || n._id.toString()}`,
    },
  }));

  await pushQueue.addBulk(jobs);

  return { persisted: inserted.length, enqueued: jobs.length };
};

/**
 * Translate a segment criteria object into a Mongo user query. Today's
 * segment filters are placeholders, so we return `{}` (all users). When the
 * segmentation layer lands, swap this for the real translation.
 */
const buildSegmentQuery = (_segment) => {
  // TODO: location / interests / purchase_history / cart_status / merchant_following
  return {};
};
