import { getQueue } from '../lib/queue/queues.js';
import { QUEUE_NAMES } from '../lib/queue/queueNames.js';
import { sendSuccess, sendError } from '../lib/response.js';
import logger from '../lib/logger.js';

/**
 * Admin DLQ tooling. BullMQ already keeps a "failed" set per queue (jobs that
 * exhausted retries), so we don't maintain separate DLQ queues — these
 * endpoints just expose the native sets.
 */

const SHORT_TO_FULL = Object.freeze({
  push: QUEUE_NAMES.PUSH,
  email: QUEUE_NAMES.EMAIL,
  sms: QUEUE_NAMES.SMS,
  fanout: QUEUE_NAMES.FANOUT,
  maintenance: QUEUE_NAMES.MAINTENANCE,
});

const resolveQueueName = (param) => {
  if (!param) return null;
  if (SHORT_TO_FULL[param]) return SHORT_TO_FULL[param];
  if (Object.values(QUEUE_NAMES).includes(param)) return param;
  return null;
};

const COUNT_STATES = ['waiting', 'active', 'delayed', 'failed', 'completed', 'paused'];

/**
 * GET /api/admin/queues/stats
 * Per-queue job counts. Useful as a single dashboard panel.
 */
export const getQueueStats = async (req, res) => {
  try {
    const stats = {};
    for (const [shortName, fullName] of Object.entries(SHORT_TO_FULL)) {
      try {
        const queue = getQueue(fullName);
        const counts = await queue.getJobCounts(...COUNT_STATES);
        stats[shortName] = { name: fullName, counts };
      } catch (err) {
        // One unreachable queue shouldn't black-hole the whole stats call.
        stats[shortName] = { name: fullName, error: err.message };
      }
    }
    return sendSuccess(res, { data: stats, message: 'Queue stats retrieved' });
  } catch (error) {
    logger.error('Failed to fetch queue stats', { error: error.message });
    return sendError(res, {
      message: 'Failed to fetch queue stats',
      code: 'QUEUE_STATS_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * GET /api/admin/queues/:queue/failed?limit=50&offset=0
 * List failed jobs in newest-first order with their failure reason.
 */
export const listFailedJobs = async (req, res) => {
  const queueName = resolveQueueName(req.params.queue);
  if (!queueName) {
    return sendError(res, {
      message: `Unknown queue: ${req.params.queue}`,
      code: 'UNKNOWN_QUEUE',
      statusCode: 400,
    });
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  try {
    const queue = getQueue(queueName);
    // BullMQ getFailed(start, end) is inclusive on both ends, newest first.
    const jobs = await queue.getFailed(offset, offset + limit - 1);
    const total = await queue.getJobCountByTypes('failed');

    const data = jobs.map((j) => ({
      id: j.id,
      name: j.name,
      attemptsMade: j.attemptsMade,
      maxAttempts: j.opts?.attempts,
      failedReason: j.failedReason,
      stacktrace: Array.isArray(j.stacktrace) ? j.stacktrace.slice(0, 3) : null,
      timestamp: j.timestamp,
      finishedOn: j.finishedOn,
      // Trim job.data so we don't dump huge payloads into the dashboard.
      dataPreview: previewData(j.data),
    }));

    return sendSuccess(res, {
      data,
      message: 'Failed jobs retrieved',
      meta: { queue: queueName, limit, offset, total },
    });
  } catch (error) {
    logger.error('Failed to list failed jobs', {
      queue: queueName,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to list failed jobs',
      code: 'LIST_FAILED_JOBS_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * POST /api/admin/queues/:queue/retry
 * Body: { ids?: string[] }
 *
 * If `ids` is provided, retry just those jobs. Otherwise, retry every job in
 * the failed set. BullMQ moves them back to 'waiting' with attemptsMade reset.
 */
export const retryFailedJobs = async (req, res) => {
  const queueName = resolveQueueName(req.params.queue);
  if (!queueName) {
    return sendError(res, {
      message: `Unknown queue: ${req.params.queue}`,
      code: 'UNKNOWN_QUEUE',
      statusCode: 400,
    });
  }

  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;

  try {
    const queue = getQueue(queueName);
    let retried = 0;
    const errors = [];

    if (ids?.length) {
      for (const id of ids) {
        try {
          const job = await queue.getJob(id);
          if (!job) {
            errors.push({ id, error: 'not_found' });
            continue;
          }
          await job.retry();
          retried++;
        } catch (err) {
          errors.push({ id, error: err.message });
        }
      }
    } else {
      // Retry the entire failed set. BullMQ provides this as a one-shot.
      // Returns the count it actually moved back.
      retried = await queue.retryJobs({ state: 'failed', count: 1000 });
    }

    logger.info('Retried failed jobs', { queue: queueName, retried, errors: errors.length });
    return sendSuccess(res, {
      data: { retried, errors },
      message: 'Retry submitted',
    });
  } catch (error) {
    logger.error('Failed to retry jobs', { queue: queueName, error: error.message });
    return sendError(res, {
      message: 'Failed to retry jobs',
      code: 'RETRY_JOBS_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * POST /api/admin/queues/:queue/drain
 * Body: { olderThanDays?: number }   (default: 7)
 *
 * Removes failed jobs whose finishedOn is older than the cutoff. Without this,
 * the failed set grows unboundedly even though removeOnFail keeps a TTL —
 * admins sometimes want to clear the slate after fixing a systemic bug.
 */
export const drainFailedJobs = async (req, res) => {
  const queueName = resolveQueueName(req.params.queue);
  if (!queueName) {
    return sendError(res, {
      message: `Unknown queue: ${req.params.queue}`,
      code: 'UNKNOWN_QUEUE',
      statusCode: 400,
    });
  }

  const days = Number.isFinite(req.body?.olderThanDays)
    ? Math.max(0, req.body.olderThanDays)
    : 7;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;

  try {
    const queue = getQueue(queueName);
    let removed = 0;
    let scanned = 0;
    const pageSize = 100;
    // Walk the failed set in pages until we run out of jobs older than cutoff.
    // Newest jobs come first, so once we hit a job younger than the cutoff in a
    // page we keep scanning the remainder of the page (failed list isn't
    // strictly age-ordered post-retry) but stop after the first all-young page.
    for (let offset = 0; ; offset += pageSize) {
      const jobs = await queue.getFailed(offset, offset + pageSize - 1);
      if (!jobs.length) break;
      scanned += jobs.length;

      let pageHadOldJobs = false;
      for (const j of jobs) {
        const ts = j.finishedOn || j.timestamp;
        if (ts && ts < cutoff) {
          try {
            await j.remove();
            removed++;
            pageHadOldJobs = true;
          } catch (err) {
            logger.warn('Failed to remove drained job', {
              queue: queueName,
              jobId: j.id,
              error: err.message,
            });
          }
        }
      }
      // Page was all-young → safe to stop walking.
      if (!pageHadOldJobs) break;
    }

    logger.info('Drained failed jobs', { queue: queueName, removed, scanned, days });
    return sendSuccess(res, {
      data: { removed, scanned, olderThanDays: days },
      message: 'Drain complete',
    });
  } catch (error) {
    logger.error('Failed to drain jobs', { queue: queueName, error: error.message });
    return sendError(res, {
      message: 'Failed to drain jobs',
      code: 'DRAIN_JOBS_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * Trim job.data to a small, safe preview. We don't want huge marketing
 * payloads or PII flooding the admin UI.
 */
const previewData = (data) => {
  if (!data || typeof data !== 'object') return data;
  const preview = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') preview[k] = v.length > 200 ? v.slice(0, 200) + '…' : v;
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) preview[k] = v;
    else if (Array.isArray(v)) preview[k] = `[Array(${v.length})]`;
    else if (typeof v === 'object') preview[k] = '[Object]';
  }
  return preview;
};
