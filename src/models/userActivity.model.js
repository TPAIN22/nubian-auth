// models/userActivity.model.js
import mongoose from 'mongoose';

const userActivitySchema = new mongoose.Schema({
  userId: {
    type: String, // Clerk ID or null for guests
    required: false,
    index: true,
  },
  sessionId: {
    type: String,
    required: true,
    index: true,
  },
  event: {
    type: String,
    required: true,
    enum: [
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
    ],
    index: true,
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: false,
    index: true,
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: false,
    index: true,
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Merchant',
    required: false,
    index: true,
  },
  searchQuery: {
    type: String,
    required: false,
    trim: true,
  },
  screen: {
    type: String,
    required: false,
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
  },
  device: {
    type: String,
    enum: ['ios', 'android', 'web'],
    required: false,
  },
  // Additional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    required: false,
  },
}, {
  timestamps: true,
});

// Compound indexes for common queries
userActivitySchema.index({ userId: 1, event: 1, timestamp: -1 });
userActivitySchema.index({ sessionId: 1, event: 1, timestamp: -1 });
userActivitySchema.index({ productId: 1, event: 1, timestamp: -1 });
userActivitySchema.index({ categoryId: 1, event: 1, timestamp: -1 });
userActivitySchema.index({ storeId: 1, event: 1, timestamp: -1 });
userActivitySchema.index({ event: 1, timestamp: -1 });

// TTL index to automatically delete old events after 90 days
userActivitySchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const UserActivity = mongoose.model('UserActivity', userActivitySchema);

export default UserActivity;
