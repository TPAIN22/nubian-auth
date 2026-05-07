import axios from 'axios';
import logger from '../../lib/logger.js';
import PushToken from '../../models/pushToken.model.js';
import Notification from '../../models/notification.model.js';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100; // Expo allows up to 100 messages per request
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Pure delivery layer for push notifications. Knows nothing about queues —
 * the sync fallback path and the BullMQ worker both call this.
 *
 * Loads the Notification by id, fetches its recipient's active push tokens,
 * batches messages to Expo, parses receipts, updates Notification.status.
 *
 * @param {string} notificationId - Mongo _id
 * @returns {Promise<{ status: 'sent'|'failed', tokensSent: number, tokensFailed: number, invalidTokenIds: string[] }>}
 */
export const deliverPushNotification = async (notificationId) => {
  const notification = await Notification.findById(notificationId);
  if (!notification) {
    const err = new Error(`Notification not found: ${notificationId}`);
    err.unrecoverable = true; // bad reference — don't retry
    throw err;
  }

  const tokens = await fetchActiveTokens(notification);
  if (tokens.length === 0) {
    await markNotification(notification, { status: 'failed', lastError: 'no_active_tokens' });
    logger.warn('Push delivery skipped — no active tokens', {
      notificationId: notification._id.toString(),
      recipientType: notification.recipientType,
      recipientId: notification.recipientId.toString(),
    });
    return { status: 'failed', tokensSent: 0, tokensFailed: 0, invalidTokenIds: [] };
  }

  const { messages, invalidTokenIds } = buildExpoMessages(notification, tokens);
  if (messages.length === 0) {
    await markNotification(notification, { status: 'failed', lastError: 'no_valid_tokens' });
    return { status: 'failed', tokensSent: 0, tokensFailed: tokens.length, invalidTokenIds };
  }

  const { totalSent, totalErrors } = await sendInChunks(messages, notification._id.toString());

  if (invalidTokenIds.length > 0) {
    await PushToken.updateMany({ _id: { $in: invalidTokenIds } }, { isActive: false });
  }

  if (totalSent > 0) {
    await markNotification(notification, {
      status: 'sent',
      channel: 'push',
      sentAt: new Date(),
      lastError: null,
    });
    return { status: 'sent', tokensSent: totalSent, tokensFailed: totalErrors, invalidTokenIds };
  }

  // Every receipt errored. Caller (worker) will see this via thrown Error and
  // BullMQ will retry per the queue's backoff policy.
  await markNotification(notification, {
    status: 'failed',
    channel: 'push',
    lastError: `expo_all_failed (${totalErrors})`,
  });
  const err = new Error(`Expo rejected all ${totalErrors} messages`);
  err.totalErrors = totalErrors;
  throw err;
};

/**
 * Fetch active Expo push tokens for the notification's recipient.
 */
const fetchActiveTokens = async (notification) => {
  if (notification.recipientType === 'merchant') {
    return PushToken.getActiveTokensForMerchant(notification.recipientId);
  }
  return PushToken.getActiveTokensForUser(notification.recipientId);
};

/**
 * Build Expo message objects, splitting tokens into valid + invalid buckets.
 * Invalid tokens (wrong format) are returned so the caller can deactivate them.
 */
const buildExpoMessages = (notification, tokens) => {
  const messages = [];
  const invalidTokenIds = [];

  for (const t of tokens) {
    if (!t.token || !t.token.startsWith('ExponentPushToken[')) {
      invalidTokenIds.push(t._id);
      continue;
    }
    messages.push({
      to: t.token,
      sound: 'default',
      title: notification.title,
      body: notification.body,
      data: {
        notificationId: notification._id.toString(),
        type: notification.type,
        deepLink: notification.deepLink || null,
        metadata: notification.metadata || {},
      },
      priority: notification.priority > 50 ? 'high' : 'default',
      badge: 1,
    });
  }

  return { messages, invalidTokenIds };
};

/**
 * POST messages to Expo in chunks of EXPO_CHUNK_SIZE. Counts per-receipt
 * outcomes so the caller can decide success/failure.
 */
const sendInChunks = async (messages, notificationId) => {
  let totalSent = 0;
  let totalErrors = 0;

  for (let i = 0; i < messages.length; i += EXPO_CHUNK_SIZE) {
    const chunk = messages.slice(i, i + EXPO_CHUNK_SIZE);
    try {
      const response = await axios.post(EXPO_PUSH_ENDPOINT, chunk, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      });

      const receipts = response?.data?.data;
      if (!Array.isArray(receipts)) {
        // Treat the whole chunk as failed — Expo response was malformed.
        totalErrors += chunk.length;
        logger.warn('Expo response missing data array', {
          notificationId,
          status: response.status,
        });
        continue;
      }

      for (const r of receipts) {
        if (r.status === 'ok') totalSent++;
        else totalErrors++;
      }
    } catch (err) {
      totalErrors += chunk.length;
      logger.error('Expo chunk send failed', {
        notificationId,
        chunkSize: chunk.length,
        error: err.message,
        statusCode: err.response?.status,
      });
    }
  }

  return { totalSent, totalErrors };
};

/**
 * Apply a status patch to the Notification document. Centralised so every
 * status change goes through the same code path and updates `lastAttemptAt`.
 */
const markNotification = async (notification, patch) => {
  Object.assign(notification, patch);
  notification.lastAttemptAt = new Date();
  if (typeof notification.attempts === 'number') notification.attempts += 1;
  else notification.attempts = 1;
  await notification.save();
};
