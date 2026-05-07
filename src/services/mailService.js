import logger from '../lib/logger.js';
import { enqueue } from '../lib/queue/queues.js';
import { QUEUE_NAMES, JOB_NAMES } from '../lib/queue/queueNames.js';
import { wrap } from '../lib/queue/jobShapes.js';
import {
  sendWelcomeEmail,
  sendOrderEmail,
  sendMerchantSuspensionEmail,
  sendMerchantUnsuspensionEmail,
} from '../lib/mail.js';

/**
 * Producer-side wrapper around lib/mail.js. Controllers call queue<X>Email()
 * instead of importing lib/mail.js directly. Behaviour:
 *
 *   ENABLE_QUEUE=true  → enqueue an EMAIL job (worker calls Resend later).
 *                        On Redis failure, fall back to a direct Resend call
 *                        so a Redis outage never silently drops critical mail.
 *   ENABLE_QUEUE=false → call the underlying lib/mail.js function directly.
 *                        Identical to the pre-queue behaviour.
 *
 * `critical: true` raises BullMQ priority (lower number = sooner) and
 * tightens the retry budget — used for welcome and order confirmations.
 */
const isQueueEnabled = () => process.env.ENABLE_QUEUE === 'true';

// BullMQ priority: lower = higher priority. Default queue runs at 10.
const CRITICAL_PRIORITY = 1;
const DEFAULT_PRIORITY = 10;

const directSenders = {
  [JOB_NAMES.EMAIL_WELCOME]: sendWelcomeEmail,
  [JOB_NAMES.EMAIL_ORDER]: sendOrderEmail,
  [JOB_NAMES.EMAIL_MERCHANT_SUSPENSION]: sendMerchantSuspensionEmail,
  [JOB_NAMES.EMAIL_MERCHANT_UNSUSPENSION]: sendMerchantUnsuspensionEmail,
};

const enqueueEmail = async (jobName, payload, { critical, jobId }) => {
  const opts = { priority: critical ? CRITICAL_PRIORITY : DEFAULT_PRIORITY };
  if (jobId) opts.jobId = jobId;
  if (critical) {
    // Tighter retry for critical mail: 8 attempts, faster initial backoff.
    opts.attempts = 8;
    opts.backoff = { type: 'exponential', delay: 3000 };
  }
  try {
    await enqueue(QUEUE_NAMES.EMAIL, jobName, wrap(payload), opts);
    return true;
  } catch (err) {
    logger.error('Email enqueue failed', { jobName, error: err.message });
    return false;
  }
};

const sendOrEnqueue = async (jobName, payload, opts = {}) => {
  if (isQueueEnabled()) {
    const enqueued = await enqueueEmail(jobName, payload, opts);
    if (enqueued) return { queued: true };
    logger.warn('Falling back to sync email send (Redis unreachable)', { jobName });
  }
  // Sync path: caller-side .catch / try-catch handles errors, matching the
  // prior contract of the lib/mail.js functions.
  const send = directSenders[jobName];
  if (!send) throw new Error(`Unknown email job: ${jobName}`);
  await send(payload);
  return { queued: false };
};

/**
 * Welcome email — fires once per new user on first sync. Critical priority.
 * Dedup by recipient so a re-sync doesn't double-email.
 */
export const queueWelcomeEmail = (payload) =>
  sendOrEnqueue(JOB_NAMES.EMAIL_WELCOME, payload, {
    critical: true,
    jobId: payload?.to ? `email:welcome:${payload.to}` : undefined,
  });

/**
 * Order confirmation / status update email. Critical priority. Dedup by
 * (orderNumber, status) so a duplicate controller call doesn't double-email,
 * but later status updates for the same order still go through.
 */
export const queueOrderEmail = (payload) =>
  sendOrEnqueue(JOB_NAMES.EMAIL_ORDER, payload, {
    critical: true,
    jobId:
      payload?.orderNumber && payload?.status
        ? `email:order:${payload.orderNumber}:${payload.status}`
        : undefined,
  });

/**
 * Merchant suspension email. Default priority. Dedup by (recipient,
 * suspendedAt) so a duplicate admin click doesn't double-email, but a future
 * resuspension still emails.
 */
export const queueMerchantSuspensionEmail = (payload) => {
  const ts =
    payload?.suspendedAt instanceof Date
      ? payload.suspendedAt.getTime()
      : payload?.suspendedAt
        ? new Date(payload.suspendedAt).getTime()
        : null;
  return sendOrEnqueue(JOB_NAMES.EMAIL_MERCHANT_SUSPENSION, payload, {
    jobId: payload?.to && ts ? `email:suspension:${payload.to}:${ts}` : undefined,
  });
};

/**
 * Merchant unsuspension email. Default priority. No jobId-based dedup —
 * unsuspensions don't carry a stable timestamp in the payload, and a missed
 * unsuspension email is worse than a rare duplicate.
 */
export const queueMerchantUnsuspensionEmail = (payload) =>
  sendOrEnqueue(JOB_NAMES.EMAIL_MERCHANT_UNSUSPENSION, payload);
