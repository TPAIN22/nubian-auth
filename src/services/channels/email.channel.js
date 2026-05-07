import logger from '../../lib/logger.js';
import {
  sendWelcomeEmail,
  sendOrderEmail,
  sendMerchantSuspensionEmail,
  sendMerchantUnsuspensionEmail,
} from '../../lib/mail.js';
import { JOB_NAMES } from '../../lib/queue/queueNames.js';

/**
 * Pure delivery layer for email. The worker dispatches on job.name to the
 * right template; the sync fallback path can call this directly too.
 *
 * Resend errors with HTTP 4xx (bad recipient, rejected sender) are
 * non-retriable — caller should surface `err.unrecoverable = true`.
 */
export const deliverEmail = async (jobName, payload) => {
  switch (jobName) {
    case JOB_NAMES.EMAIL_WELCOME:
      return wrapResend(jobName, () => sendWelcomeEmail(payload));
    case JOB_NAMES.EMAIL_ORDER:
      return wrapResend(jobName, () => sendOrderEmail(payload));
    case JOB_NAMES.EMAIL_MERCHANT_SUSPENSION:
      return wrapResend(jobName, () => sendMerchantSuspensionEmail(payload));
    case JOB_NAMES.EMAIL_MERCHANT_UNSUSPENSION:
      return wrapResend(jobName, () => sendMerchantUnsuspensionEmail(payload));
    default: {
      const err = new Error(`Unknown email job name: ${jobName}`);
      err.unrecoverable = true;
      throw err;
    }
  }
};

const wrapResend = async (jobName, fn) => {
  try {
    const result = await fn();
    logger.info('Email sent', { jobName, id: result?.data?.id || result?.id || null });
    return result;
  } catch (err) {
    // Resend SDK throws on 4xx/5xx. 4xx (bad recipient, invalid template, etc)
    // is unrecoverable — retrying won't change the outcome.
    const status = err?.statusCode || err?.response?.status;
    if (status && status >= 400 && status < 500) {
      err.unrecoverable = true;
    }
    logger.error('Email send failed', {
      jobName,
      error: err.message,
      statusCode: status,
      unrecoverable: !!err.unrecoverable,
    });
    throw err;
  }
};
