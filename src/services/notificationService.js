import axios from 'axios';
import mongoose from 'mongoose';
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
      
      // Log enabled channels for debugging
      logger.info('Notification channel check', {
        type,
        requestedChannel: channel,
        enabledChannels,
        globalPushEnabled: preferences.channels?.push,
        globalInAppEnabled: preferences.channels?.in_app,
        typePref: preferences.types[type],
        recipientId: recipientObjectId.toString(),
        recipientType,
      });
      
      if (!enabledChannels.includes(channel) && channel !== 'in_app') {
        logger.warn('Notification channel disabled by user preferences - will only create in-app', {
          type,
          channel,
          enabledChannels,
          recipientId: recipientObjectId.toString(),
        });
        // Still create in-app notification even if channel is disabled
        // In-app is always available
      }

      // Generate deduplication key if not provided
      const finalDedupKey = deduplicationKey || `${type}_${recipientObjectId}_${JSON.stringify(metadata)}`;

      // Check for duplicate notifications (deduplication) - skip for test notifications
      const isTestNotification = metadata?.test === true;
      if (preferences.antiSpam?.enabled && !isTestNotification) {
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
      // For push channel specifically requested, try to send even if not in enabledChannels (for testing)
      // But respect user preferences for actual production notifications
      const channelsToSend = enabledChannels.filter(c => c !== 'in_app'); // in_app already created
      
      // If push was explicitly requested but not in enabledChannels, log warning but still try to send for debugging
      if (channel === 'push' && !channelsToSend.includes('push')) {
        logger.warn('Push channel requested but not enabled in preferences - attempting to send anyway', {
          notificationId: notification._id.toString(),
          type,
          enabledChannels,
          bypassReason: 'explicit channel request',
        });
        // Try to send push notification anyway for debugging
        try {
          await this.sendPushNotification(notification, preferences);
        } catch (error) {
          logger.error('Failed to send push notification (bypassed preferences)', {
            error: error.message,
            notificationId: notification._id.toString(),
          });
        }
      } else if (channelsToSend.includes('push')) {
        // Normal flow: push is enabled in preferences
        await this.sendPushNotification(notification, preferences);
      } else {
        logger.info('Push notification skipped - not in enabled channels', {
          notificationId: notification._id.toString(),
          type,
          enabledChannels,
          requestedChannel: channel,
        });
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
        // First try the direct method
        tokens = await PushToken.getActiveTokensForUser(notification.recipientId);
        
        // If no tokens found, try to find by User model lookup (in case userId is wrong)
        if (tokens.length === 0) {
          const user = await User.findById(notification.recipientId);
          if (user && user.clerkId) {
            // Try to find user by clerkId and get tokens
            const userWithClerkId = await User.findOne({ clerkId: user.clerkId });
            if (userWithClerkId) {
              tokens = await PushToken.getActiveTokensForUser(userWithClerkId._id);
            }
          }
        }
        
        logger.info('Fetching push tokens for user', {
          notificationId: notification._id.toString(),
          recipientId: notification.recipientId.toString(),
          recipientType: notification.recipientType,
          tokenCount: tokens.length,
          recipientIdType: typeof notification.recipientId,
        });
      } else if (notification.recipientType === 'merchant') {
        tokens = await PushToken.getActiveTokensForMerchant(notification.recipientId);
        logger.info('Fetching push tokens for merchant', {
          notificationId: notification._id.toString(),
          recipientId: notification.recipientId.toString(),
          recipientType: notification.recipientType,
          tokenCount: tokens.length,
        });
      }

      if (tokens.length === 0) {
        logger.warn('No active push tokens found for recipient', {
          notificationId: notification._id.toString(),
          recipientId: notification.recipientId.toString(),
          recipientType: notification.recipientType,
          // Debug: Check if any tokens exist for this user/merchant at all
          debugQuery: {
            type: notification.recipientType,
            id: notification.recipientId.toString(),
          },
        });
        
        // Check total tokens for debugging
        const allTokens = notification.recipientType === 'user'
          ? await PushToken.find({ userId: notification.recipientId }).limit(5)
          : await PushToken.find({ merchantId: notification.recipientId }).limit(5);
        
        logger.info('Debug: All tokens for recipient (including inactive)', {
          recipientId: notification.recipientId.toString(),
          recipientType: notification.recipientType,
          totalTokensFound: allTokens.length,
          sampleTokens: allTokens.map(t => ({
            id: t._id.toString(),
            isActive: t.isActive,
            expiresAt: t.expiresAt,
            hasUserId: !!t.userId,
            hasMerchantId: !!t.merchantId,
          })),
        });
        
        notification.status = 'failed';
        notification.channel = 'push';
        await notification.save();
        return notification;
      }

      // Validate Expo push tokens and prepare push messages
      const messages = [];
      const invalidTokens = [];
      
      tokens.forEach((token) => {
        // Validate Expo push token format (should start with ExponentPushToken[)
        if (!token.token || !token.token.startsWith('ExponentPushToken[')) {
          invalidTokens.push({
            tokenId: token._id.toString(),
            tokenPrefix: token.token?.substring(0, 30) + '...',
            reason: 'Invalid Expo push token format',
          });
          return;
        }
        
        messages.push({
          to: token.token,
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
          badge: 1, // TODO: Calculate actual badge count
        });
      });
      
      if (invalidTokens.length > 0) {
        logger.warn('Invalid Expo push tokens found', {
          notificationId: notification._id.toString(),
          invalidCount: invalidTokens.length,
          validCount: messages.length,
          invalidTokens: invalidTokens.slice(0, 5), // Log first 5
        });
      }
      
      if (messages.length === 0) {
        logger.error('No valid push messages to send', {
          notificationId: notification._id.toString(),
          totalTokens: tokens.length,
          invalidTokens: invalidTokens.length,
        });
        notification.status = 'failed';
        notification.channel = 'push';
        await notification.save();
        return notification;
      }

      // Send in chunks
      const chunks = this.chunkArray(messages, this.chunkSize);
      const results = [];
      let totalSent = 0;
      let totalErrors = 0;

      logger.info('Sending push notification to Expo', {
        notificationId: notification._id.toString(),
        tokenCount: messages.length,
        chunkCount: chunks.length,
      });

      for (const chunk of chunks) {
        try {
          const response = await axios.post(this.expoPushEndpoint, chunk, {
            headers: {
              Accept: 'application/json',
              'Accept-Encoding': 'gzip, deflate',
              'Content-Type': 'application/json',
            },
            timeout: 30000, // 30 second timeout
          });
          
          results.push(response.data);
          
          // Check Expo API response for errors
          if (response.data && response.data.data) {
            const receipts = response.data.data;
            receipts.forEach((receipt, index) => {
              if (receipt.status === 'error') {
                totalErrors++;
                logger.error('Expo push notification error for individual notification', {
                  notificationId: notification._id.toString(),
                  error: receipt.message,
                  errorCode: receipt.details?.error,
                  token: chunk[index]?.to?.substring(0, 20) + '...',
                });
              } else if (receipt.status === 'ok') {
                totalSent++;
              }
            });
          }
        } catch (error) {
          totalErrors += chunk.length;
          logger.error('Failed to send push notification chunk to Expo', {
            error: error.message,
            errorResponse: error.response?.data,
            chunkSize: chunk.length,
            notificationId: notification._id.toString(),
            statusCode: error.response?.status,
          });
        }
      }

      // Update notification status based on results
      if (totalSent > 0) {
        notification.status = 'sent';
        notification.channel = 'push';
        notification.sentAt = new Date();
        await notification.save();
        
        logger.info('Push notification sent successfully', {
          notificationId: notification._id.toString(),
          tokensSent: totalSent,
          tokensFailed: totalErrors,
          totalTokens: messages.length,
        });
      } else {
        notification.status = 'failed';
        notification.channel = 'push';
        await notification.save();
        
        logger.error('Push notification failed - no successful sends', {
          notificationId: notification._id.toString(),
          totalErrors,
          totalTokens: messages.length,
        });
      }

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
   * Batch create notifications (for broadcasts) - Optimized with bulk operations
   */
  async batchCreateNotifications(notificationData, recipientIds, recipientType) {
    if (recipientIds.length === 0) {
      return [];
    }

    // Determine recipient model
    const recipientModel = recipientType === 'merchant' ? 'Merchant' : 'User';
    
    // Auto-determine category based on notification type
    const typeCategoryMap = {
      ORDER_CREATED: 'transactional',
      ORDER_ACCEPTED: 'transactional',
      ORDER_SHIPPED: 'transactional',
      ORDER_DELIVERED: 'transactional',
      ORDER_CANCELLED: 'transactional',
      REFUND_PROCESSED: 'transactional',
      NEW_ORDER: 'merchant_alerts',
      LOW_STOCK: 'merchant_alerts',
      PRODUCT_APPROVED: 'merchant_alerts',
      PRODUCT_REJECTED: 'merchant_alerts',
      PAYOUT_STATUS: 'merchant_alerts',
      CART_ABANDONED: 'behavioral',
      VIEWED_NOT_PURCHASED: 'behavioral',
      PRICE_DROPPED: 'behavioral',
      BACK_IN_STOCK: 'behavioral',
      NEW_ARRIVALS: 'marketing',
      FLASH_SALE: 'marketing',
      MERCHANT_PROMOTION: 'marketing',
      PERSONALIZED_OFFER: 'marketing',
    };
    const category = typeCategoryMap[notificationData.type] || 'transactional';

    // Set priority based on type
    const priorityMap = {
      ORDER_CREATED: 90,
      ORDER_ACCEPTED: 85,
      ORDER_SHIPPED: 80,
      ORDER_DELIVERED: 75,
      ORDER_CANCELLED: 70,
      NEW_ORDER: 95,
      LOW_STOCK: 60,
      PRODUCT_APPROVED: 50,
      PRODUCT_REJECTED: 55,
      CART_ABANDONED: 40,
      PRICE_DROPPED: 30,
      BACK_IN_STOCK: 35,
      FLASH_SALE: 45,
      NEW_ARRIVALS: 20,
      MERCHANT_PROMOTION: 15,
      PERSONALIZED_OFFER: 25,
    };
    const priority = priorityMap[notificationData.type] || 50;

    // Prepare bulk insert operations
    const bulkOps = recipientIds.map((recipientId) => ({
      insertOne: {
        document: {
          type: notificationData.type,
          recipientType,
          recipientId,
          recipientModel,
          title: notificationData.title,
          body: notificationData.body,
          deepLink: notificationData.deepLink || null,
          metadata: notificationData.metadata || {},
          channel: 'in_app', // Always create in-app first
          priority,
          category,
          isRead: false,
          status: 'pending',
          sentAt: null, // Will be set after push notification is sent
          deduplicationKey: `${notificationData.type}_${recipientId}_${JSON.stringify(notificationData.metadata || {})}`,
          expiresAt: notificationData.expiresAt || null,
          merchantId: notificationData.merchantId || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    }));

    // Execute bulk insert
    try {
      const result = await Notification.bulkWrite(bulkOps, { ordered: false });
      logger.info('Bulk notifications created', {
        recipientType,
        inserted: result.insertedCount,
        recipientIds: recipientIds.length,
      });

      // Fetch created notifications immediately after bulk insert
      const createdNotifications = await Notification.find({
        recipientType,
        recipientId: { $in: recipientIds },
        type: notificationData.type,
        status: 'pending',
      }).limit(1000); // Limit for push notification batch

      // Send push notifications asynchronously (don't await - process in background)
      if (notificationData.channel === 'push' && createdNotifications.length > 0) {
        // Process push notifications in background - don't block the response
        // Use Promise to run async but don't await
        this.sendBroadcastPushNotifications(createdNotifications, notificationData, recipientType)
          .then(() => {
            logger.info('Broadcast push notifications sent successfully', {
              notificationCount: createdNotifications.length,
              recipientType,
            });
          })
          .catch((error) => {
            logger.error('Failed to send broadcast push notifications in background', {
              error: error.message,
              stack: error.stack,
              notificationCount: createdNotifications.length,
              recipientType,
            });
          });
      }

      // Return immediately with created notifications
      return createdNotifications;
    } catch (error) {
      logger.error('Failed to bulk create notifications', {
        error: error.message,
        recipientType,
        recipientCount: recipientIds.length,
      });
      throw error;
    }
  }

  /**
   * Send push notifications for broadcast (async, non-blocking)
   */
  async sendBroadcastPushNotifications(notifications, notificationData, recipientType) {
    try {
      if (!notifications || notifications.length === 0) {
        logger.info('No notifications to send push for');
        return;
      }

      // Group notifications by recipient to get all their tokens at once
      // recipientId is already an ObjectId from the database
      const recipientIds = [...new Set(notifications.map(n => {
        const id = n.recipientId;
        // Ensure it's an ObjectId
        return id.toString ? id.toString() : String(id);
      }))];
      
      logger.info('Sending broadcast push notifications', {
        recipientType,
        recipientCount: recipientIds.length,
        notificationCount: notifications.length,
      });
      
      // Get all push tokens for recipients based on recipient type
      // recipientIds are ObjectIds from the database, but convert to ObjectId instances for query
      const tokenQuery = recipientType === 'merchant'
        ? {
            merchantId: { $in: recipientIds.map(id => new mongoose.Types.ObjectId(id)) },
            isActive: true,
            $or: [
              { expiresAt: { $exists: false } },
              { expiresAt: { $gt: new Date() } },
            ],
          }
        : {
            userId: { $in: recipientIds.map(id => new mongoose.Types.ObjectId(id)) },
            isActive: true,
            $or: [
              { expiresAt: { $exists: false } },
              { expiresAt: { $gt: new Date() } },
            ],
          };
      
      const tokens = await PushToken.find(tokenQuery);
      logger.info('Found push tokens for broadcast', {
        tokenCount: tokens.length,
        recipientCount: recipientIds.length,
        recipientType,
      });

      if (tokens.length === 0) {
        logger.warn('No active push tokens found for broadcast recipients', {
          recipientType,
          recipientCount: recipientIds.length,
          sampleRecipientIds: recipientIds.slice(0, 5), // Log first 5 for debugging
        });
        
        // Mark notifications as failed since no tokens found
        await Notification.updateMany(
          { _id: { $in: notifications.map(n => n._id) } },
          {
            $set: {
              status: 'failed',
              channel: 'push',
            },
          }
        );
        return;
      }

      // Prepare push messages - map each notification to its recipient's tokens
      // Group tokens by recipientId for proper notification-to-token mapping
      const tokensByRecipient = {};
      tokens.forEach(token => {
        const recipientId = (token.userId || token.merchantId).toString();
        if (!tokensByRecipient[recipientId]) {
          tokensByRecipient[recipientId] = [];
        }
        tokensByRecipient[recipientId].push(token);
      });

      // Determine priority based on notification type (same logic as in batchCreateNotifications)
      const priorityMap = {
        ORDER_CREATED: 90,
        ORDER_ACCEPTED: 85,
        ORDER_SHIPPED: 80,
        ORDER_DELIVERED: 75,
        ORDER_CANCELLED: 70,
        NEW_ORDER: 95,
        LOW_STOCK: 60,
        PRODUCT_APPROVED: 50,
        PRODUCT_REJECTED: 55,
        CART_ABANDONED: 40,
        PRICE_DROPPED: 30,
        BACK_IN_STOCK: 35,
        FLASH_SALE: 45,
        NEW_ARRIVALS: 20,
        MERCHANT_PROMOTION: 15,
        PERSONALIZED_OFFER: 25,
      };
      const priority = notificationData.priority || priorityMap[notificationData.type] || 50;
      
      // Create push messages for all tokens
      const messages = [];
      Object.values(tokensByRecipient).flat().forEach((token) => {
        messages.push({
          to: token.token,
          sound: 'default',
          title: notificationData.title,
          body: notificationData.body,
          data: {
            type: notificationData.type,
            deepLink: notificationData.deepLink || null,
            metadata: notificationData.metadata || {},
          },
          priority: priority > 50 ? 'high' : 'default',
          badge: 1,
        });
      });

      // Send in chunks to Expo
      const chunks = this.chunkArray(messages, this.chunkSize);
      let totalSent = 0;
      let totalErrors = 0;
      
      for (const chunk of chunks) {
        try {
          logger.info('Sending push notification chunk to Expo', {
            chunkSize: chunk.length,
            sampleToken: chunk[0]?.to?.substring(0, 20) + '...',
          });
          
          const response = await axios.post(this.expoPushEndpoint, chunk, {
            headers: {
              Accept: 'application/json',
              'Accept-Encoding': 'gzip, deflate',
              'Content-Type': 'application/json',
            },
            timeout: 30000, // 30 second timeout per chunk
          });
          
          // Expo API returns data with receipts
          if (response.data && response.data.data) {
            const receipts = response.data.data;
            receipts.forEach((receipt, index) => {
              if (receipt.status === 'error') {
                totalErrors++;
                logger.error('Expo push notification error', {
                  error: receipt.message,
                  errorCode: receipt.details?.error,
                  token: chunk[index]?.to?.substring(0, 20) + '...',
                });
              } else if (receipt.status === 'ok') {
                totalSent++;
              }
            });
          }
          
          logger.info('Expo push notification chunk sent', {
            chunkSize: chunk.length,
            responseStatus: response.status,
            successCount: totalSent,
            errorCount: totalErrors,
          });
        } catch (error) {
          totalErrors += chunk.length;
          logger.error('Failed to send push notification chunk to Expo', {
            error: error.message,
            errorResponse: error.response?.data,
            chunkSize: chunk.length,
            statusCode: error.response?.status,
          });
        }
      }

      // Update notification statuses to sent
      await Notification.updateMany(
        { _id: { $in: notifications.map(n => n._id) } },
        {
          $set: {
            status: 'sent',
            channel: 'push',
            sentAt: new Date(),
          },
        }
      );

      logger.info('Broadcast push notifications sent', {
        tokensSent: messages.length,
        notifications: notifications.length,
      });
    } catch (error) {
      logger.error('Failed to send broadcast push notifications', {
        error: error.message,
      });
    }
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
