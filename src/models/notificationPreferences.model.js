import mongoose from 'mongoose';

// User notification preferences schema
const notificationPreferencesSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
      // Polymorphic reference
      refPath: 'recipientModel',
    },
    recipientType: {
      type: String,
      required: true,
      enum: ['user', 'merchant', 'admin'],
      index: true,
    },
    recipientModel: {
      type: String,
      required: true,
      enum: ['User', 'Merchant'],
    },
    // Channel preferences
    channels: {
      pushNotifications: { type: Boolean, default: true },
      in_app: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
    },
    // Type-based preferences - using Mixed type for flexible nested structure
    types: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        // Transactional (critical - usually can't be disabled)
        ORDER_CREATED: { enabled: true, channels: { push: true, in_app: true } },
        ORDER_ACCEPTED: { enabled: true, channels: { push: true, in_app: true } },
        ORDER_SHIPPED: { enabled: true, channels: { push: true, in_app: true } },
        ORDER_DELIVERED: { enabled: true, channels: { push: true, in_app: true } },
        ORDER_CANCELLED: { enabled: true, channels: { push: true, in_app: true } },
        REFUND_PROCESSED: { enabled: true, channels: { push: true, in_app: true } },
        // Merchant alerts
        NEW_ORDER: { enabled: true, channels: { push: true, in_app: true } },
        LOW_STOCK: { enabled: true, channels: { push: true, in_app: true } },
        PRODUCT_APPROVED: { enabled: true, channels: { push: true, in_app: true } },
        PRODUCT_REJECTED: { enabled: true, channels: { push: true, in_app: true } },
        PAYOUT_STATUS: { enabled: true, channels: { push: true, in_app: true } },
        // Behavioral
        CART_ABANDONED: { enabled: true, channels: { push: true, in_app: true } },
        VIEWED_NOT_PURCHASED: { enabled: false, channels: { push: false, in_app: true } },
        PRICE_DROPPED: { enabled: true, channels: { push: true, in_app: true } },
        BACK_IN_STOCK: { enabled: true, channels: { push: true, in_app: true } },
        // Marketing
        NEW_ARRIVALS: { enabled: true, channels: { push: false, in_app: true } },
        FLASH_SALE: { enabled: true, channels: { push: true, in_app: true } },
        MERCHANT_PROMOTION: { enabled: true, channels: { push: false, in_app: true } },
        PERSONALIZED_OFFER: { enabled: true, channels: { push: true, in_app: true } },
      },
    },
    // Quiet hours - no push notifications during these times
    quietHours: {
      enabled: { type: Boolean, default: false },
      start: { type: String, default: '22:00' }, // 10 PM
      end: { type: String, default: '08:00' }, // 8 AM
      timezone: { type: String, default: 'UTC' },
    },
    // Rate limiting preferences
    rateLimiting: {
      enabled: { type: Boolean, default: true },
      maxPerHour: { type: Number, default: 10 },
      maxPerDay: { type: Number, default: 50 },
    },
    // Anti-spam settings
    antiSpam: {
      enabled: { type: Boolean, default: true },
      minIntervalBetweenSameType: { type: Number, default: 300 }, // 5 minutes in seconds
    },
  },
  {
    timestamps: true,
  }
);

// Helper method to check if a notification type is enabled
notificationPreferencesSchema.methods.isTypeEnabled = function (type) {
  return this.types[type]?.enabled !== false;
};

// Helper method to get enabled channels for a type
notificationPreferencesSchema.methods.getEnabledChannels = function (type) {
  const typePref = this.types[type];
  if (!typePref || !typePref.enabled) return [];

  const enabledChannels = [];
  if (typePref.channels?.push && this.channels.pushNotifications) enabledChannels.push('push');
  if (typePref.channels?.in_app && this.channels.in_app) enabledChannels.push('in_app');
  if (typePref.channels?.sms && this.channels.sms) enabledChannels.push('sms');
  if (typePref.channels?.email && this.channels.email) enabledChannels.push('email');

  return enabledChannels;
};

// Helper method to check if current time is in quiet hours
notificationPreferencesSchema.methods.isInQuietHours = function () {
  if (!this.quietHours.enabled) return false;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;

  const [startHour, startMinute] = this.quietHours.start.split(':').map(Number);
  const [endHour, endMinute] = this.quietHours.end.split(':').map(Number);
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;

  // Handle quiet hours that span midnight (e.g., 22:00 to 08:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime;
  } else {
    return currentTime >= startTime && currentTime < endTime;
  }
};

// Static method to get or create preferences
notificationPreferencesSchema.statics.getOrCreate = async function (recipientId, recipientType, recipientModel) {
  let prefs = await this.findOne({ recipientId, recipientType });
  if (!prefs) {
    prefs = await this.create({
      recipientId,
      recipientType,
      recipientModel,
    });
  }
  return prefs;
};

const NotificationPreferences = mongoose.model('NotificationPreferences', notificationPreferencesSchema);
export default NotificationPreferences;
