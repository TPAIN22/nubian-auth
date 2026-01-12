// controllers/tracking.controller.js
import { getAuth } from '@clerk/express';
import { sendSuccess, sendError } from '../lib/response.js';
import logger from '../lib/logger.js';
import UserActivity from '../models/userActivity.model.js';
import { updateRealTimeCache } from '../services/trackingCache.service.js';
import mongoose from 'mongoose';

/**
 * Track user event
 * POST /api/tracking/event
 */
export const trackEvent = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const {
      event,
      sessionId,
      productId,
      categoryId,
      storeId,
      searchQuery,
      screen,
      timestamp,
      device,
      ...metadata
    } = req.body;

    // Validate required fields
    if (!event || !sessionId) {
      return sendError(res, {
        message: 'Event and sessionId are required',
      }, 400);
    }

    // Validate event type
    const validEvents = [
      'product_view',
      'product_click',
      'add_to_cart',
      'remove_from_cart',
      'category_open',
      'store_open',
      'banner_click',
      'search_query',
      'filter_used',
      'scroll_depth',
      'product_impression',
      'recommendation_click',
      'purchase',
      'wishlist_add',
      'share_click',
    ];

    if (!validEvents.includes(event)) {
      return sendError(res, {
        message: `Invalid event type. Must be one of: ${validEvents.join(', ')}`,
      }, 400);
    }

    // Prepare activity data
    const activityData = {
      userId: userId || null,
      sessionId,
      event,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      device: device || null,
      screen: screen || null,
      searchQuery: searchQuery || null,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };

    // Add references if provided
    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      activityData.productId = new mongoose.Types.ObjectId(productId);
    }
    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
      activityData.categoryId = new mongoose.Types.ObjectId(categoryId);
    }
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      activityData.storeId = new mongoose.Types.ObjectId(storeId);
    }

    // Save activity
    const activity = new UserActivity(activityData);
    await activity.save();

    // Update real-time cache (non-blocking, synchronous)
    updateRealTimeCache(event, {
      productId,
      categoryId,
      storeId,
    });

    // Return success immediately (fire and forget for performance)
    return sendSuccess(res, {
      message: 'Event tracked successfully',
      data: {
        id: activity._id,
        event: activity.event,
      },
    }, 201);
  } catch (error) {
    logger.error('Error tracking event', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

    // Don't fail the request if tracking fails
    return sendError(res, {
      message: 'Failed to track event',
      error: error.message,
    }, 500);
  }
};

/**
 * Merge guest session with user account
 * POST /api/tracking/merge-session
 */
export const mergeSession = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { sessionId } = req.body;

    if (!userId) {
      return sendError(res, {
        message: 'User must be authenticated',
      }, 401);
    }

    if (!sessionId) {
      return sendError(res, {
        message: 'SessionId is required',
      }, 400);
    }

    // Update all activities with this sessionId to use userId
    const result = await UserActivity.updateMany(
      { sessionId, userId: null },
      { $set: { userId } }
    );

    logger.info('Session merged successfully', {
      requestId: req.requestId,
      userId,
      sessionId,
      updatedCount: result.modifiedCount,
    });

    return sendSuccess(res, {
      message: 'Session merged successfully',
      data: {
        updatedCount: result.modifiedCount,
      },
    });
  } catch (error) {
    logger.error('Error merging session', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

    return sendError(res, {
      message: 'Failed to merge session',
      error: error.message,
    }, 500);
  }
};
