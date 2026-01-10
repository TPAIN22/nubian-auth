import notificationService from '../services/notificationService.js';
import NotificationPreferences from '../models/notificationPreferences.model.js';
import PushToken from '../models/notifications.model.js';
import User from '../models/user.model.js';
import Merchant from '../models/merchant.model.js';
import { getAuth } from '@clerk/express';
import logger from '../lib/logger.js';
import { sendSuccess, sendError, sendCreated, sendNotFound } from '../lib/response.js';
import {
  createMarketingNotification,
  handleCartAbandoned,
  handleLowStock,
  handleBackInStock,
  handleRefundProcessed,
} from '../services/notificationEventHandlers.js';

/**
 * Save push token (Expo push token strategy)
 * Supports anonymous tokens (allowAnonymous: true)
 * Supports multi-device (multiDevice: true)
 */
export const savePushToken = async (req, res) => {
  try {
    const { token, platform, deviceId, deviceName, appVersion, osVersion } = req.body;
    const { userId } = getAuth(req); // May be null for anonymous users

    if (!token) {
      return sendError(res, {
        message: 'Expo push token is required',
        code: 'MISSING_TOKEN',
        statusCode: 400,
      });
    }

    // Check if token already exists
    let pushToken = await PushToken.findOne({ token });

    if (pushToken) {
      // Update existing token
      pushToken.lastUsedAt = new Date();
      pushToken.isActive = true;
      if (platform) pushToken.platform = platform;
      if (deviceId) pushToken.deviceId = deviceId;
      if (deviceName) pushToken.deviceName = deviceName;
      if (appVersion) pushToken.appVersion = appVersion;
      if (osVersion) pushToken.osVersion = osVersion;

      // If user logged in and token was anonymous, merge it (onLoginMerge: true)
      if (userId && !pushToken.userId) {
        const user = await User.findOne({ clerkId: userId });
        if (user) {
          await PushToken.mergeAnonymousTokens(deviceId, user._id);
          pushToken.userId = user._id;
        }
      } else if (userId && !pushToken.userId) {
        const user = await User.findOne({ clerkId: userId });
        if (user) {
          pushToken.userId = user._id;
        }
      }

      await pushToken.save();
    } else {
      // Create new token
      let userIdObjectId = null;
      if (userId) {
        const user = await User.findOne({ clerkId: userId });
        if (user) userIdObjectId = user._id;
      }

      pushToken = await PushToken.create({
        token,
        platform,
        deviceId,
        deviceName,
        appVersion,
        osVersion,
        userId: userIdObjectId, // null for anonymous users (allowAnonymous: true)
      });
    }

    // Refresh expiration
    pushToken.refreshExpiration();

    logger.info('Push token saved', {
      token: pushToken.token.substring(0, 20) + '...',
      userId: pushToken.userId?.toString() || 'anonymous',
      platform,
      deviceId,
    });

    return sendSuccess(res, {
      data: {
        tokenId: pushToken._id.toString(),
        saved: true,
      },
      message: 'Token saved successfully',
    });
  } catch (error) {
    logger.error('Failed to save push token', {
      error: error.message,
      stack: error.stack,
    });
    return sendError(res, {
      message: 'Failed to save push token',
      code: 'SAVE_TOKEN_FAILED',
      statusCode: 500,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * Save merchant push token (for merchant panel)
 */
export const saveMerchantPushToken = async (req, res) => {
  try {
    const { token, platform, deviceId, deviceName, appVersion, osVersion } = req.body;
    const { userId } = getAuth(req);

    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }

    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });
    if (!merchant) {
      return sendError(res, {
        message: 'Merchant not found or not approved',
        code: 'MERCHANT_NOT_FOUND',
        statusCode: 403,
      });
    }

    if (!token) {
      return sendError(res, {
        message: 'Expo push token is required',
        code: 'MISSING_TOKEN',
        statusCode: 400,
      });
    }

    let pushToken = await PushToken.findOne({ token });

    if (pushToken) {
      pushToken.lastUsedAt = new Date();
      pushToken.isActive = true;
      pushToken.merchantId = merchant._id;
      if (platform) pushToken.platform = platform;
      if (deviceId) pushToken.deviceId = deviceId;
      if (deviceName) pushToken.deviceName = deviceName;
      if (appVersion) pushToken.appVersion = appVersion;
      if (osVersion) pushToken.osVersion = osVersion;
      await pushToken.save();
    } else {
      pushToken = await PushToken.create({
        token,
        platform,
        deviceId,
        deviceName,
        appVersion,
        osVersion,
        merchantId: merchant._id,
      });
    }

    pushToken.refreshExpiration();

    return sendSuccess(res, {
      data: {
        tokenId: pushToken._id.toString(),
        saved: true,
      },
      message: 'Merchant push token saved successfully',
    });
  } catch (error) {
    logger.error('Failed to save merchant push token', {
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to save merchant push token',
      code: 'SAVE_TOKEN_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * Get notifications for current user/merchant
 */
export const getNotifications = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { limit = 50, offset = 0, category, isRead, type } = req.query;

    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }

    // Determine recipient type (user or merchant)
    const user = await User.findOne({ clerkId: userId });
    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });

    let recipientType = 'user';
    let recipientId = user?._id;

    if (merchant && !user) {
      recipientType = 'merchant';
      recipientId = merchant._id;
    } else if (!user) {
      return sendError(res, {
        message: 'User not found',
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      });
    }

    const result = await notificationService.getNotifications(
      recipientId,
      recipientType,
      {
        limit: parseInt(limit),
        offset: parseInt(offset),
        category: category || null,
        isRead: isRead !== undefined ? isRead === 'true' : null,
        type: type || null,
      }
    );

    return sendSuccess(res, {
      data: result,
      message: 'Notifications retrieved successfully',
    });
  } catch (error) {
    logger.error('Failed to get notifications', {
      error: error.message,
      stack: error.stack,
    });
    return sendError(res, {
      message: 'Failed to retrieve notifications',
      code: 'GET_NOTIFICATIONS_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * Get unread notification count
 */
export const getUnreadCount = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { category } = req.query;

    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }

    const user = await User.findOne({ clerkId: userId });
    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });

    let recipientType = 'user';
    let recipientId = user?._id;

    if (merchant && !user) {
      recipientType = 'merchant';
      recipientId = merchant._id;
    } else if (!user) {
      return sendError(res, {
        message: 'User not found',
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      });
    }

    const count = await notificationService.getUnreadCount(
      recipientId,
      recipientType,
      category || null
    );

    return sendSuccess(res, {
      data: { count },
      message: 'Unread count retrieved successfully',
    });
  } catch (error) {
    logger.error('Failed to get unread count', {
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to retrieve unread count',
      code: 'GET_UNREAD_COUNT_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * Mark notification as read
 */
export const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { userId } = getAuth(req);

    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }

    const user = await User.findOne({ clerkId: userId });
    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });

    let recipientType = 'user';
    let recipientId = user?._id;

    if (merchant && !user) {
      recipientType = 'merchant';
      recipientId = merchant._id;
    } else if (!user) {
      return sendError(res, {
        message: 'User not found',
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      });
    }

    const notification = await notificationService.markAsRead(
      notificationId,
      recipientId,
      recipientType
    );

    if (!notification) {
      return sendNotFound(res, 'Notification');
    }

    return sendSuccess(res, {
      data: notification,
      message: 'Notification marked as read',
    });
  } catch (error) {
    logger.error('Failed to mark notification as read', {
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to mark notification as read',
      code: 'MARK_AS_READ_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * Mark multiple notifications as read
 */
export const markMultipleAsRead = async (req, res) => {
  try {
    const { notificationIds } = req.body;
    const { userId } = getAuth(req);

    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return sendError(res, {
        message: 'notificationIds must be a non-empty array',
        code: 'INVALID_NOTIFICATION_IDS',
        statusCode: 400,
      });
    }

    const user = await User.findOne({ clerkId: userId });
    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });

    let recipientType = 'user';
    let recipientId = user?._id;

    if (merchant && !user) {
      recipientType = 'merchant';
      recipientId = merchant._id;
    } else if (!user) {
      return sendError(res, {
        message: 'User not found',
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      });
    }

    const result = await notificationService.markMultipleAsRead(
      notificationIds,
      recipientId,
      recipientType
    );

    return sendSuccess(res, {
      data: {
        modifiedCount: result.modifiedCount || 0,
      },
      message: 'Notifications marked as read',
    });
  } catch (error) {
    logger.error('Failed to mark multiple notifications as read', {
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to mark notifications as read',
      code: 'MARK_MULTIPLE_AS_READ_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * Get notification preferences
 */
export const getPreferences = async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }

    const user = await User.findOne({ clerkId: userId });
    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });

    let recipientType = 'user';
    let recipientId = user?._id;
    let recipientModel = 'User';

    if (merchant && !user) {
      recipientType = 'merchant';
      recipientId = merchant._id;
      recipientModel = 'Merchant';
    } else if (!user) {
      return sendError(res, {
        message: 'User not found',
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      });
    }

    const preferences = await NotificationPreferences.getOrCreate(
      recipientId,
      recipientType,
      recipientModel
    );

    return sendSuccess(res, {
      data: preferences,
      message: 'Preferences retrieved successfully',
    });
  } catch (error) {
    logger.error('Failed to get preferences', {
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to retrieve preferences',
      code: 'GET_PREFERENCES_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * Update notification preferences
 */
export const updatePreferences = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { channels, types, quietHours, rateLimiting, antiSpam } = req.body;

    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }

    const user = await User.findOne({ clerkId: userId });
    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });

    let recipientType = 'user';
    let recipientId = user?._id;
    let recipientModel = 'User';

    if (merchant && !user) {
      recipientType = 'merchant';
      recipientId = merchant._id;
      recipientModel = 'Merchant';
    } else if (!user) {
      return sendError(res, {
        message: 'User not found',
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      });
    }

    const preferences = await NotificationPreferences.getOrCreate(
      recipientId,
      recipientType,
      recipientModel
    );

    if (channels) {
      Object.assign(preferences.channels, channels);
    }
    if (types) {
      Object.keys(types).forEach((type) => {
        if (preferences.types[type]) {
          Object.assign(preferences.types[type], types[type]);
        }
      });
    }
    if (quietHours) {
      Object.assign(preferences.quietHours, quietHours);
    }
    if (rateLimiting) {
      Object.assign(preferences.rateLimiting, rateLimiting);
    }
    if (antiSpam) {
      Object.assign(preferences.antiSpam, antiSpam);
    }

    await preferences.save();

    return sendSuccess(res, {
      data: preferences,
      message: 'Preferences updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update preferences', {
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to update preferences',
      code: 'UPDATE_PREFERENCES_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * Send broadcast notification (Admin only)
 */
export const sendBroadcast = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { type, title, body, deepLink, metadata, target } = req.body; // target: 'users' | 'merchants' | 'all'

    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }

    // Check if user is admin (you'll need to implement admin check)
    // For now, we'll allow it - implement proper admin check in middleware

    if (!type || !title || !body) {
      return sendError(res, {
        message: 'type, title, and body are required',
        code: 'MISSING_REQUIRED_FIELDS',
        statusCode: 400,
      });
    }

    let notifications = [];

    if (target === 'users' || target === 'all') {
      const userNotifications = await notificationService.broadcastToUsers({
        type,
        title,
        body,
        deepLink,
        metadata,
        channel: 'push',
      });
      notifications = notifications.concat(userNotifications);
    }

    if (target === 'merchants' || target === 'all') {
      const merchantNotifications = await notificationService.broadcastToMerchants({
        type,
        title,
        body,
        deepLink,
        metadata,
        channel: 'push',
      });
      notifications = notifications.concat(merchantNotifications);
    }

    return sendSuccess(res, {
      data: {
        sent: notifications.length,
        notifications: notifications.map((n) => n._id.toString()),
      },
      message: 'Broadcast notification sent successfully',
    });
  } catch (error) {
    logger.error('Failed to send broadcast notification', {
      error: error.message,
      stack: error.stack,
    });
    return sendError(res, {
      message: 'Failed to send broadcast notification',
      code: 'BROADCAST_FAILED',
      statusCode: 500,
    });
  }
};

/**
 * Send marketing notification (Admin/Merchant)
 */
export const sendMarketingNotification = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { type, title, body, deepLink, metadata, targetRecipients } = req.body;

    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }

    if (!type || !title || !body) {
      return sendError(res, {
        message: 'type, title, and body are required',
        code: 'MISSING_REQUIRED_FIELDS',
        statusCode: 400,
      });
    }

    const notifications = await createMarketingNotification(type, {
      title,
      body,
      deepLink,
      metadata,
      targetRecipients,
    });

    return sendSuccess(res, {
      data: {
        sent: notifications.length,
        notifications: notifications.map((n) => n._id.toString()),
      },
      message: 'Marketing notification sent successfully',
    });
  } catch (error) {
    logger.error('Failed to send marketing notification', {
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to send marketing notification',
      code: 'MARKETING_NOTIFICATION_FAILED',
      statusCode: 500,
    });
  }
};

// Legacy endpoints for backward compatibility
export const saveNotification = async (req, res) => {
  try {
    const { title, body, userId, deviceId } = req.body;

    if (!title || !body || (!userId && !deviceId)) {
      return sendError(res, {
        message: 'title, body, and userId or deviceId are required',
        code: 'MISSING_REQUIRED_FIELDS',
        statusCode: 400,
      });
    }

    // This is a legacy endpoint - use the new notification service
    // For backward compatibility, we'll still support it but use the new system
    let recipientId = userId;
    let recipientType = 'user';

    if (userId) {
      const user = await User.findOne({ clerkId: userId });
      if (user) {
        recipientId = user._id;
      }
    }

    const notification = await notificationService.createNotification({
      type: 'MERCHANT_PROMOTION', // Default type for legacy endpoint
      recipientType,
      recipientId: recipientId || deviceId, // Fallback to deviceId if no user
      title,
      body,
      channel: 'in_app',
    });

    return sendSuccess(res, {
      data: notification,
      message: 'Notification saved',
    });
  } catch (error) {
    logger.error('Failed to save notification (legacy)', {
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to save notification',
      code: 'SAVE_NOTIFICATION_FAILED',
      statusCode: 500,
    });
  }
};
