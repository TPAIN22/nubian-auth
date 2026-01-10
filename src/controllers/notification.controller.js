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

    if (!deviceId) {
      return sendError(res, {
        message: 'Device ID is required',
        code: 'MISSING_DEVICE_ID',
        statusCode: 400,
      });
    }

    // PRIMARY APPROACH: Find token by deviceId first (device-based token management)
    // Each device should have one active token record, which gets updated when user logs in/out
    // Strategy:
    // 1. Find active token by deviceId (preferred)
    // 2. If not found, find any token by deviceId (could be inactive) and reactivate it
    // 3. If still not found, check if token string exists (might be from different device)
    // 4. If nothing found, create new token
    
    let pushToken = await PushToken.findOne({ 
      deviceId,
      isActive: true,
    }).sort({ lastUsedAt: -1 }); // Get the most recently used active token for this device
    
    // If no active token found, look for any token (including inactive) for this device
    if (!pushToken) {
      pushToken = await PushToken.findOne({ 
        deviceId,
      }).sort({ lastUsedAt: -1 });
      
      if (pushToken) {
        logger.info('Found inactive token for device - will reactivate it', {
          tokenId: pushToken._id.toString(),
          deviceId,
          wasActive: pushToken.isActive,
        });
      }
    }

    logger.info('Processing push token (device-based)', {
      deviceTokenExists: !!pushToken,
      deviceId,
      hasUserId: !!userId,
      existingTokenUserId: pushToken?.userId?.toString() || 'none',
      existingTokenId: pushToken?._id?.toString() || 'none',
      existingTokenActive: pushToken?.isActive || false,
      tokenPreview: token.substring(0, 30) + '...',
    });

    if (pushToken) {
      // Token exists for this device - update it
      // This handles:
      // 1. Token refresh (Expo token changed)
      // 2. User login (add userId)
      // 3. User logout (keep userId or clear it)
      // 4. User switch (update userId to new user)
      
      const oldUserId = pushToken.userId?.toString() || null;
      const oldToken = pushToken.token;
      
      // Update token and metadata
      pushToken.token = token; // Update Expo token (might have changed)
      pushToken.lastUsedAt = new Date();
      pushToken.isActive = true;
      if (platform) pushToken.platform = platform;
      if (deviceName) pushToken.deviceName = deviceName;
      if (appVersion) pushToken.appVersion = appVersion;
      if (osVersion) pushToken.osVersion = osVersion;

      // Handle userId based on user login status
      if (userId) {
        // User is logged in - find user and update userId
        const user = await User.findOne({ clerkId: userId });
        if (user) {
          const newUserId = user._id;
          
          if (!oldUserId) {
            // No previous userId - user just logged in on this device
            logger.info('User logged in - adding userId to device token', {
              tokenId: pushToken._id.toString(),
              deviceId,
              clerkId: userId,
              newUserId: newUserId.toString(),
            });
            
            // Also merge any other anonymous tokens for this device (if any)
            await PushToken.mergeAnonymousTokens(deviceId, newUserId);
            
            pushToken.userId = newUserId;
          } else if (oldUserId !== newUserId.toString()) {
            // Different user logged in on same device - update to new user
            logger.info('Different user logged in on same device - updating userId', {
              tokenId: pushToken._id.toString(),
              deviceId,
              oldUserId,
              newUserId: newUserId.toString(),
            });
            pushToken.userId = newUserId;
          } else {
            // Same user - token already linked, just update lastUsedAt
            logger.info('Same user on device - updating token metadata', {
              tokenId: pushToken._id.toString(),
              deviceId,
              userId: newUserId.toString(),
            });
          }
        } else {
          logger.warn('User not found for clerkId, cannot link token', {
            clerkId: userId,
            tokenId: pushToken._id.toString(),
            deviceId,
          });
        }
      } else {
        // User is not logged in (anonymous)
        if (oldUserId) {
          // User logged out - keep userId for now (tokens persist after logout)
          // This allows notifications to still reach the device if user logged out
          // Uncomment the next line if you want to clear userId on logout:
          // pushToken.userId = null;
          
          logger.info('User logged out - keeping token with userId for persistent notifications', {
            tokenId: pushToken._id.toString(),
            deviceId,
            userId: oldUserId,
          });
        } else {
          logger.info('Anonymous user on device - updating token metadata', {
            tokenId: pushToken._id.toString(),
            deviceId,
          });
        }
      }

      // If token changed, log it
      if (oldToken !== token) {
        logger.info('Expo push token updated for device', {
          tokenId: pushToken._id.toString(),
          deviceId,
          oldTokenPreview: oldToken.substring(0, 30) + '...',
          newTokenPreview: token.substring(0, 30) + '...',
        });
      }

      await pushToken.save();
    } else {
      // No token exists for this device - create new one
      let userIdObjectId = null;
      
      if (userId) {
        // User is logged in during first registration
        const user = await User.findOne({ clerkId: userId });
        if (user) {
          userIdObjectId = user._id;
          logger.info('Creating new device token with userId (user logged in)', {
            deviceId,
            clerkId: userId,
            mongoUserId: user._id.toString(),
          });
        } else {
          logger.warn('User not found for clerkId when creating new token', {
            clerkId: userId,
            deviceId,
          });
        }
      } else {
        // Anonymous registration
        logger.info('Creating new anonymous device token (no userId)', {
          deviceId,
        });
      }

      // No token found for this device - check if token string exists (might be from different device)
      const existingTokenByString = await PushToken.findOne({ token });
      
      if (existingTokenByString) {
        // Token string exists but for different device (or deviceId wasn't set) - update it
        logger.info('Token string exists but not for this device - updating deviceId and reactivating', {
          existingTokenId: existingTokenByString._id.toString(),
          oldDeviceId: existingTokenByString.deviceId,
          newDeviceId: deviceId,
        });
        
        existingTokenByString.deviceId = deviceId;
        existingTokenByString.token = token; // Update in case it changed
        existingTokenByString.lastUsedAt = new Date();
        existingTokenByString.isActive = true;
        if (platform) existingTokenByString.platform = platform;
        if (deviceName) existingTokenByString.deviceName = deviceName;
        if (appVersion) existingTokenByString.appVersion = appVersion;
        if (osVersion) existingTokenByString.osVersion = osVersion;
        if (userIdObjectId) existingTokenByString.userId = userIdObjectId;
        
        pushToken = existingTokenByString;
        await pushToken.save();
        
        logger.info('Updated existing token with new deviceId', {
          tokenId: pushToken._id.toString(),
          deviceId,
          userId: userIdObjectId?.toString() || 'anonymous',
        });
      } else {
        // Completely new token - create it
        // Deactivate any other active tokens for this device first (ensure only one active token per device)
        await PushToken.updateMany(
          { deviceId, isActive: true },
          { isActive: false }
        );
        
        logger.info('Deactivated old tokens for device before creating new one', {
          deviceId,
        });
        
        try {
          pushToken = await PushToken.create({
            token,
            platform,
            deviceId,
            deviceName,
            appVersion,
            osVersion,
            userId: userIdObjectId, // null for anonymous users
          });
          
          logger.info('Created new device token successfully', {
            tokenId: pushToken._id.toString(),
            deviceId,
            userId: userIdObjectId?.toString() || 'anonymous',
          });
        } catch (createError) {
          // Handle unique constraint violation (token already exists - shouldn't happen after check, but just in case)
          if (createError.code === 11000 || createError.name === 'MongoServerError') {
            // Token string exists - find and update it
            const tokenExists = await PushToken.findOne({ token });
            if (tokenExists) {
              logger.info('Token string exists during create - updating it', {
                existingTokenId: tokenExists._id.toString(),
              });
              
              tokenExists.deviceId = deviceId;
              tokenExists.lastUsedAt = new Date();
              tokenExists.isActive = true;
              if (platform) tokenExists.platform = platform;
              if (deviceName) tokenExists.deviceName = deviceName;
              if (appVersion) tokenExists.appVersion = appVersion;
              if (osVersion) tokenExists.osVersion = osVersion;
              if (userIdObjectId) tokenExists.userId = userIdObjectId;
              
              pushToken = tokenExists;
              await pushToken.save();
            } else {
              logger.error('Unique constraint error but token not found', {
                error: createError.message,
                deviceId,
              });
              throw createError;
            }
          } else {
            // Handle any other unexpected errors
            logger.error('Failed to create push token', {
              error: createError.message,
              errorCode: createError.code,
              deviceId,
              tokenPreview: token.substring(0, 30) + '...',
            });
            throw createError;
          }
        }
      }
    }

    // Refresh expiration
    await pushToken.refreshExpiration();

    logger.info('Push token saved successfully (device-based)', {
      tokenId: pushToken._id.toString(),
      deviceId: pushToken.deviceId,
      tokenPreview: pushToken.token.substring(0, 30) + '...',
      userId: pushToken.userId?.toString() || 'anonymous',
      merchantId: pushToken.merchantId?.toString() || 'none',
      platform: pushToken.platform,
      isActive: pushToken.isActive,
      expiresAt: pushToken.expiresAt,
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
      // Handle simplified preferences from mobile app
      // Auto-create categories if they don't exist
      Object.keys(types).forEach((category) => {
        if (!preferences.types[category]) {
          // Initialize category with default structure
          preferences.types[category] = {
            enabled: true,
            channels: {
              push: preferences.channels.push || true,
              in_app: true,
              sms: false,
              email: false,
            },
          };
        }
        
        // Update the category preferences
        if (types[category].enabled !== undefined) {
          preferences.types[category].enabled = types[category].enabled;
        }
        
        // Update channels for this category
        if (types[category].channels) {
          if (!preferences.types[category].channels) {
            preferences.types[category].channels = {};
          }
          Object.assign(preferences.types[category].channels, types[category].channels);
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
 * Optimized to return immediately and process asynchronously
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

    // Get counts for immediate response
    let userCount = 0;
    let merchantCount = 0;

    if (target === 'users' || target === 'all') {
      userCount = await User.countDocuments({});
    }

    if (target === 'merchants' || target === 'all') {
      merchantCount = await Merchant.countDocuments({ status: 'APPROVED' });
    }

    const totalRecipients = userCount + merchantCount;

    // Process broadcast asynchronously (don't await)
    // Return immediately with estimated count
    (async () => {
      try {
        if (target === 'users' || target === 'all') {
          await notificationService.broadcastToUsers({
            type,
            title,
            body,
            deepLink,
            metadata,
            channel: 'push',
          });
        }

        if (target === 'merchants' || target === 'all') {
          await notificationService.broadcastToMerchants({
            type,
            title,
            body,
            deepLink,
            metadata,
            channel: 'push',
          });
        }

        logger.info('Broadcast notification processed successfully', {
          type,
          target,
          estimatedRecipients: totalRecipients,
        });
      } catch (error) {
        logger.error('Failed to process broadcast notification asynchronously', {
          error: error.message,
          stack: error.stack,
          type,
          target,
        });
      }
    })();

    // Return immediately with estimated count
    return sendSuccess(res, {
      data: {
        sent: totalRecipients, // Estimated count
        estimatedRecipients: totalRecipients,
        users: userCount,
        merchants: merchantCount,
        status: 'processing',
        message: 'Broadcast notification is being processed in the background',
      },
      message: 'Broadcast notification queued successfully',
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

/**
 * Test endpoint: Send a test notification to the current user
 * Helps debug notification delivery issues
 */
export const sendTestNotification = async (req, res) => {
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

    // Check push tokens for this user/merchant (active tokens only)
    let tokens = [];
    if (recipientType === 'user') {
      tokens = await PushToken.getActiveTokensForUser(recipientId);
    } else {
      tokens = await PushToken.getActiveTokensForMerchant(recipientId);
    }

    // Also check all tokens (including inactive) for debugging
    const allTokens = recipientType === 'user'
      ? await PushToken.find({ userId: recipientId }).limit(10)
      : await PushToken.find({ merchantId: recipientId }).limit(10);
    
    // Also check tokens by clerkId (in case userId wasn't set correctly)
    const tokensByClerkId = await PushToken.find({
      $or: [
        { userId: null }, // Anonymous tokens that might need to be merged
      ],
    }).limit(10);

    // Send test notification - use ORDER_CREATED type which always has push enabled
    // Also bypass preference checks for test notifications to ensure delivery
    const testNotification = await notificationService.createNotification({
      type: 'ORDER_CREATED', // This type always has push enabled and is transactional (high priority)
      recipientType,
      recipientId,
      title: '🔔 Test Notification',
      body: 'This is a test notification to verify push notification delivery. If you received this, push notifications are working!',
      deepLink: null,
      metadata: { test: true, timestamp: new Date().toISOString() },
      channel: 'push',
      priority: 90, // High priority
    });

    return sendSuccess(res, {
      data: {
        notificationId: testNotification?._id?.toString() || null,
        recipientType,
        recipientId: recipientId.toString(),
        activeTokensCount: tokens.length,
        totalTokensCount: allTokens.length,
        tokens: allTokens.map(t => ({
          id: t._id.toString(),
          token: t.token.substring(0, 30) + '...',
          platform: t.platform,
          isActive: t.isActive,
          expiresAt: t.expiresAt,
          lastUsedAt: t.lastUsedAt,
          userId: t.userId?.toString() || null,
          merchantId: t.merchantId?.toString() || null,
          hasUserId: !!t.userId,
          hasMerchantId: !!t.merchantId,
          matchesRecipient: recipientType === 'user' 
            ? (t.userId?.toString() === recipientId.toString())
            : (t.merchantId?.toString() === recipientId.toString()),
        })),
        anonymousTokens: tokensByClerkId.length,
        debug: {
          userId,
          clerkId: userId,
          mongoUserId: recipientId.toString(),
          recipientModel,
          recipientType,
          // Check if tokens match
          tokenMatching: {
            activeTokensCount: tokens.length,
            totalTokensForRecipient: allTokens.length,
            recipientIdType: typeof recipientId,
            recipientIdString: recipientId.toString(),
            sampleTokenUserId: allTokens[0]?.userId?.toString() || 'none',
            sampleTokenMerchantId: allTokens[0]?.merchantId?.toString() || 'none',
          },
        },
        notificationStatus: testNotification?.status || 'unknown',
        pushNotificationSent: testNotification?.status === 'sent',
      },
      message: 'Test notification sent. Check your device for the notification.',
    });
  } catch (error) {
    logger.error('Failed to send test notification', {
      error: error.message,
      stack: error.stack,
    });
    return sendError(res, {
      message: 'Failed to send test notification',
      code: 'TEST_NOTIFICATION_FAILED',
      statusCode: 500,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
