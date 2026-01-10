import axios from 'axios';
import Notification from '../models/notification.model.js';
import NotificationPreferences from '../models/notificationPreferences.model.js';
import PushToken from '../models/notifications.model.js';
import logger from '../lib/logger.js';
import User from '../models/user.model.js';
import Merchant from '../models/merchant.model.js';

/**
 * Production-grade Notification Service
 * Handles all notification creation, delivery, and smart rules
 */
class NotificationService {
  constructor() {
    this.expoPushEndpoint = 'https://exp.host/--/api/v2/push/send';
    this.chunkSize = 100; // Expo allows up to 100 messages per request
  }

  /**
   * Create a notification with smart rules
   */
  async createNotification(notificationData) {
    try {
      const {
        type,
        recipientType,
        recipientId,
        title,
        body,
        deepLink = null,
        metadata = {},
        channel = 'in_app',
        priority = null,
        expiresAt = null,
        merchantId = null,
        deduplicationKey = null,
      } = notificationData;

      // Determine recipient model
      let recipientModel = 'User';
      if (recipientType === 'merchant') {
        recipientModel = 'Merchant';
      }

      // Resolve recipientId to ObjectId if it's a string (clerkId)
      let recipientObjectId = recipientId;
      if (typeof recipientId === 'string' && recipientType === 'user') {
        const user = await User.findOne({ clerkId: recipientId });
        if (!user) {
          throw new Error(`User not found: ${recipientId}`);
        }
        recipientObjectId = user._id;
      } else if (typeof recipientId === 'string' && recipientType === 'merchant') {
        const merchant = await Merchant.findOne({ clerkId: recipientId });
        if (!merchant) {
          throw new Error(`Merchant not found: ${recipientId}`);
        }
        recipientObjectId = merchant._id;
      }

      // Check preferences
      const preferences = await NotificationPreferences.getOrCreate(
        recipientObjectId,
        recipientType,
        recipientModel
      );

      // Check if notification type is enabled
      if (!preferences.isTypeEnabled(type)) {
        logger.info('Notification type disabled by user preferences', {
          type,
          recipientId: recipientObjectId.toString(),
          recipientType,
        });
        return null;
      }

      // Get enabled channels
      const enabledChannels = preferences.getEnabledChannels(type);
      if (!enabledChannels.includes(channel) && channel !== 'in_app') {
        logger.info('Notification channel disabled by user preferences', {
          type,
          channel,
          recipientId: recipientObjectId.toString(),
        });
        // Still create in-app notification even if channel is disabled
        // In-app is always available
      }

      // Generate deduplication key if not provided
      const finalDedupKey = deduplicationKey || `${type}_${recipientObjectId}_${JSON.stringify(metadata)}`;

      // Check for duplicate notifications (deduplication)
      if (preferences.antiSpam?.enabled) {
        const recentDuplicate = await Notification.findOne({
          deduplicationKey: finalDedupKey,
          recipientId: recipientObjectId,
          recipientType,
          createdAt: {
            $gte: new Date(Date.now() - (preferences.antiSpam.minIntervalBetweenSameType * 1000)),
          },
        });

        if (recentDuplicate) {
          logger.info('Duplicate notification prevented by deduplication', {
            type,
            recipientId: recipientObjectId.toString(),
            deduplicationKey: finalDedupKey,
          });
          return recentDuplicate;
        }
      }

      // Rate limiting check
      if (preferences.rateLimiting?.enabled) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const recentCountHour = await Notification.countDocuments({
          recipientId: recipientObjectId,
          recipientType,
          sentAt: { $gte: oneHourAgo },
          status: { $in: ['sent', 'delivered'] },
        });

        const recentCountDay = await Notification.countDocuments({
          recipientId: recipientObjectId,
          recipientType,
          sentAt: { $gte: oneDayAgo },
          status: { $in: ['sent', 'delivered'] },
        });

        if (recentCountHour >= preferences.rateLimiting.maxPerHour) {
          logger.warn('Rate limit exceeded (hourly)', {
            type,
            recipientId: recipientObjectId.toString(),
            count: recentCountHour,
            limit: preferences.rateLimiting.maxPerHour,
          });
          // Still create notification but mark as pending/delayed
        }

        if (recentCountDay >= preferences.rateLimiting.maxPerDay) {
          logger.warn('Rate limit exceeded (daily)', {
            type,
            recipientId: recipientObjectId.toString(),
            count: recentCountDay,
            limit: preferences.rateLimiting.maxPerDay,
          });
          // Still create notification but mark as pending/delayed
        }
      }

      // Create notification
      const notification = await Notification.create({
        type,
        recipientType,
        recipientId: recipientObjectId,
        recipientModel,
        title,
        body,
        deepLink,
        metadata,
        channel: 'in_app', // Always create in-app first
        priority,
        expiresAt,
        merchantId,
        deduplicationKey: finalDedupKey,
        status: 'pending',
      });

      // Send through enabled channels
      const channelsToSend = enabledChannels.filter(c => c !== 'in_app'); // in_app already created
      
      if (channelsToSend.includes('push')) {
        await this.sendPushNotification(notification, preferences);
      }

      // Future: Handle SMS and Email channels
      // if (channelsToSend.includes('sms')) {
      //   await this.sendSMSNotification(notification);
      // }
      // if (channelsToSend.includes('email')) {
      //   await this.sendEmailNotification(notification);
      // }

      logger.info('Notification created successfully', {
        notificationId: notification._id.toString(),
        type,
        recipientType,
        recipientId: recipientObjectId.toString(),
        channels: channelsToSend,
      });

      return notification;
    } catch (error) {
      logger.error('Failed to create notification', {
        error: error.message,
        stack: error.stack,
        notificationData,
      });
      throw error;
    }
  }

  /**
   * Send push notification via Expo
   */
  async sendPushNotification(notification, preferences) {
    try {
      // Check quiet hours
      if (preferences.isInQuietHours() && preferences.quietHours.enabled) {
        logger.info('Push notification delayed due to quiet hours', {
          notificationId: notification._id.toString(),
          recipientId: notification.recipientId.toString(),
        });
        // Still mark as pending, can be sent later
        notification.status = 'pending';
        notification.channel = 'push';
        await notification.save();
        return notification;
      }

      // Get recipient push tokens
      let tokens = [];
      if (notification.recipientType === 'user') {
        tokens = await PushToken.getActiveTokensForUser(notification.recipientId);
      } else if (notification.recipientType === 'merchant') {
        tokens = await PushToken.getActiveTokensForMerchant(notification.recipientId);
      }

      if (tokens.length === 0) {
        logger.info('No active push tokens found for recipient', {
          notificationId: notification._id.toString(),
          recipientId: notification.recipientId.toString(),
          recipientType: notification.recipientType,
        });
        notification.status = 'failed';
        notification.channel = 'push';
        await notification.save();
        return notification;
      }

      // Prepare push messages
      const messages = tokens.map((token) => ({
        to: token.token,
        sound: 'default',
        title: notification.title,
        body: notification.body,
        data: {
          notificationId: notification._id.toString(),
          type: notification.type,
          deepLink: notification.deepLink,
          metadata: notification.metadata,
        },
        priority: notification.priority > 50 ? 'high' : 'default',
        badge: 1, // TODO: Calculate actual badge count
      }));

      // Send in chunks
      const chunks = this.chunkArray(messages, this.chunkSize);
      const results = [];

      for (const chunk of chunks) {
        try {
          const response = await axios.post(this.expoPushEndpoint, chunk, {
            headers: {
              Accept: 'application/json',
              'Accept-Encoding': 'gzip, deflate',
              'Content-Type': 'application/json',
            },
          });
          results.push(response.data);
        } catch (error) {
          logger.error('Failed to send push notification chunk', {
            error: error.message,
            chunkSize: chunk.length,
            notificationId: notification._id.toString(),
          });
        }
      }

      // Update notification status
      notification.status = 'sent';
      notification.channel = 'push';
      notification.sentAt = new Date();
      await notification.save();

      logger.info('Push notification sent successfully', {
        notificationId: notification._id.toString(),
        tokensSent: messages.length,
        results: results.length,
      });

      return notification;
    } catch (error) {
      logger.error('Failed to send push notification', {
        error: error.message,
        stack: error.stack,
        notificationId: notification._id.toString(),
      });
      notification.status = 'failed';
      await notification.save();
      throw error;
    }
  }

  /**
   * Batch create notifications (for broadcasts)
   */
  async batchCreateNotifications(notificationData, recipientIds, recipientType) {
    const notifications = [];

    for (const recipientId of recipientIds) {
      try {
        const notification = await this.createNotification({
          ...notificationData,
          recipientId,
          recipientType,
        });
        if (notification) {
          notifications.push(notification);
        }
      } catch (error) {
        logger.error('Failed to create notification in batch', {
          error: error.message,
          recipientId,
          recipientType,
        });
      }
    }

    return notifications;
  }

  /**
   * Send to segmented users
   */
  async sendToSegmentedUsers(notificationData, segmentCriteria) {
    // Build query based on segment criteria
    let userQuery = {};

    if (segmentCriteria.location) {
      // TODO: Add location-based filtering when location data is available
    }

    if (segmentCriteria.interests) {
      // TODO: Add interest-based filtering
    }

    if (segmentCriteria.purchase_history) {
      // TODO: Add purchase history filtering
    }

    if (segmentCriteria.cart_status) {
      // TODO: Add cart status filtering
    }

    if (segmentCriteria.merchant_following) {
      // TODO: Add merchant following filtering
    }

    const users = await User.find(userQuery).select('_id');
    const userIds = users.map((u) => u._id);

    return this.batchCreateNotifications(notificationData, userIds, 'user');
  }

  /**
   * Broadcast to all users
   */
  async broadcastToUsers(notificationData) {
    const users = await User.find({}).select('_id');
    const userIds = users.map((u) => u._id);
    return this.batchCreateNotifications(notificationData, userIds, 'user');
  }

  /**
   * Broadcast to all merchants
   */
  async broadcastToMerchants(notificationData) {
    const merchants = await Merchant.find({ status: 'APPROVED' }).select('_id');
    const merchantIds = merchants.map((m) => m._id);
    return this.batchCreateNotifications(notificationData, merchantIds, 'merchant');
  }

  /**
   * Helper: Chunk array
   */
  chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  /**
   * Get notifications for a recipient
   */
  async getNotifications(recipientId, recipientType, options = {}) {
    const {
      limit = 50,
      offset = 0,
      category = null,
      isRead = null,
      type = null,
    } = options;

    let recipientObjectId = recipientId;
    if (typeof recipientId === 'string' && recipientType === 'user') {
      const user = await User.findOne({ clerkId: recipientId });
      if (user) recipientObjectId = user._id;
    } else if (typeof recipientId === 'string' && recipientType === 'merchant') {
      const merchant = await Merchant.findOne({ clerkId: recipientId });
      if (merchant) recipientObjectId = merchant._id;
    }

    const query = {
      recipientId: recipientObjectId,
      recipientType,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } },
      ],
    };

    if (category) query.category = category;
    if (isRead !== null) query.isRead = isRead;
    if (type) query.type = type;

    const notifications = await Notification.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .limit(limit)
      .skip(offset)
      .lean();

    const total = await Notification.countDocuments(query);

    return {
      notifications,
      total,
      limit,
      offset,
    };
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId, recipientId, recipientType) {
    let recipientObjectId = recipientId;
    if (typeof recipientId === 'string' && recipientType === 'user') {
      const user = await User.findOne({ clerkId: recipientId });
      if (user) recipientObjectId = user._id;
    } else if (typeof recipientId === 'string' && recipientType === 'merchant') {
      const merchant = await Merchant.findOne({ clerkId: recipientId });
      if (merchant) recipientObjectId = merchant._id;
    }

    return Notification.markAsRead(notificationId, recipientObjectId);
  }

  /**
   * Mark multiple notifications as read
   */
  async markMultipleAsRead(notificationIds, recipientId, recipientType) {
    let recipientObjectId = recipientId;
    if (typeof recipientId === 'string' && recipientType === 'user') {
      const user = await User.findOne({ clerkId: recipientId });
      if (user) recipientObjectId = user._id;
    } else if (typeof recipientId === 'string' && recipientType === 'merchant') {
      const merchant = await Merchant.findOne({ clerkId: recipientId });
      if (merchant) recipientObjectId = merchant._id;
    }

    return Notification.markMultipleAsRead(notificationIds, recipientObjectId);
  }

  /**
   * Get unread count
   */
  async getUnreadCount(recipientId, recipientType, category = null) {
    let recipientObjectId = recipientId;
    if (typeof recipientId === 'string' && recipientType === 'user') {
      const user = await User.findOne({ clerkId: recipientId });
      if (user) recipientObjectId = user._id;
    } else if (typeof recipientId === 'string' && recipientType === 'merchant') {
      const merchant = await Merchant.findOne({ clerkId: recipientId });
      if (merchant) recipientObjectId = merchant._id;
    }

    return Notification.getUnreadCount(recipientObjectId, recipientType, category);
  }
}

// Export singleton instance
export default new NotificationService();
