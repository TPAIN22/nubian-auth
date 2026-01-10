import mongoose from 'mongoose';

// Enhanced notification schema following the requirements
const notificationSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    },
    type: {
      type: String,
      required: true,
      enum: [
        // Transactional
        'ORDER_CREATED',
        'ORDER_ACCEPTED',
        'ORDER_SHIPPED',
        'ORDER_DELIVERED',
        'ORDER_CANCELLED',
        'REFUND_PROCESSED',
        // Merchant Alerts
        'NEW_ORDER',
        'LOW_STOCK',
        'PRODUCT_APPROVED',
        'PRODUCT_REJECTED',
        'PAYOUT_STATUS',
        // Behavioral
        'CART_ABANDONED',
        'VIEWED_NOT_PURCHASED',
        'PRICE_DROPPED',
        'BACK_IN_STOCK',
        // Marketing
        'NEW_ARRIVALS',
        'FLASH_SALE',
        'MERCHANT_PROMOTION',
        'PERSONALIZED_OFFER',
      ],
      index: true,
    },
    recipientType: {
      type: String,
      required: true,
      enum: ['user', 'merchant', 'admin'],
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      // Polymorphic reference - can reference User or Merchant
      refPath: 'recipientModel',
    },
    recipientModel: {
      type: String,
      required: true,
      enum: ['User', 'Merchant'],
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    deepLink: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // Stores additional context like orderId, productId, etc.
    },
    channel: {
      type: String,
      required: true,
      enum: ['push', 'in_app', 'sms', 'email'],
      default: 'in_app',
      index: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      index: true,
      // Notifications can expire for time-sensitive offers
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'delivered'],
      default: 'pending',
      index: true,
    },
    // Smart rules tracking
    deduplicationKey: {
      type: String,
      index: true,
      // Used to prevent duplicate notifications
    },
    // Multi-tenant support
    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      index: true,
      // For marketplace multi-tenancy
    },
    // Category for inbox organization
    category: {
      type: String,
      enum: ['transactional', 'merchant_alerts', 'behavioral', 'marketing', 'system'],
      default: 'transactional',
      index: true,
    },
    // Priority for sorting
    priority: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      // Higher priority notifications appear first
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common query patterns
notificationSchema.index({ recipientId: 1, recipientType: 1, isRead: 1 });
notificationSchema.index({ recipientId: 1, recipientType: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, recipientType: 1, category: 1, isRead: 1 });
notificationSchema.index({ recipientId: 1, recipientType: 1, status: 1 });
notificationSchema.index({ type: 1, status: 1 });
notificationSchema.index({ merchantId: 1, type: 1 });
notificationSchema.index({ expiresAt: 1, status: 1 }); // For cleanup queries
notificationSchema.index({ deduplicationKey: 1, recipientId: 1 }); // For deduplication
// Note: sentAt index is automatically created by index: true in schema, so we don't need to add it again
notificationSchema.index({ priority: -1, createdAt: -1 }); // For priority sorting

// TTL index for expired notifications cleanup (optional, can be handled manually)
// notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for unread count (can be used in aggregations)
notificationSchema.virtual('isExpired').get(function () {
  return this.expiresAt && this.expiresAt < new Date();
});

// Pre-save middleware to auto-categorize notifications
notificationSchema.pre('save', function (next) {
  try {
    // Auto-categorize based on type if category not explicitly set
    if (!this.category || this.category === 'transactional') {
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
      if (this.type) {
        this.category = typeCategoryMap[this.type] || 'transactional';
      }
    }

    // Set priority based on type only if priority is 0 (default)
    if (this.priority === 0 && this.type) {
      const priorityMap = {
        ORDER_CREATED: 90,
        ORDER_ACCEPTED: 85,
        ORDER_SHIPPED: 80,
        ORDER_DELIVERED: 75,
        ORDER_CANCELLED: 70,
        NEW_ORDER: 95, // Highest priority for merchants
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
      this.priority = priorityMap[this.type] || 10;
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Static method to mark as read
notificationSchema.statics.markAsRead = async function (notificationId, recipientId) {
  return this.findOneAndUpdate(
    { _id: notificationId, recipientId },
    { isRead: true },
    { new: true }
  );
};

// Static method to mark multiple as read
notificationSchema.statics.markMultipleAsRead = async function (notificationIds, recipientId) {
  return this.updateMany(
    { _id: { $in: notificationIds }, recipientId },
    { isRead: true }
  );
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = async function (recipientId, recipientType, category = null) {
  const query = { 
    recipientId, 
    recipientType, 
    isRead: false,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } },
    ],
  };
  if (category) query.category = category;
  return this.countDocuments(query);
};

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
