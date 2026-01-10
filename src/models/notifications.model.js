import mongoose from 'mongoose';

// Enhanced push token schema following Expo push token strategy
const pushTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ['ios', 'android', 'web'],
      index: true,
    },
    deviceId: {
      type: String,
      index: true,
      // Device identifier for multi-device support
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
      // Nullable for anonymous users (allowAnonymous: true)
    },
    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      default: null,
      index: true,
      // For merchant panel push notifications
    },
    // Token metadata
    appVersion: {
      type: String,
      default: null,
    },
    osVersion: {
      type: String,
      default: null,
    },
    // Status tracking
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    // For multi-device tracking
    deviceName: {
      type: String,
      default: null,
    },
    // For token cleanup (autoCleanup: true)
    expiresAt: {
      type: Date,
      default: null,
      index: true,
      // Tokens that haven't been used in 90 days can be cleaned up
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common queries
pushTokenSchema.index({ userId: 1, isActive: 1 });
pushTokenSchema.index({ merchantId: 1, isActive: 1 });
pushTokenSchema.index({ deviceId: 1, platform: 1 });
// Note: lastUsedAt and expiresAt indexes are automatically created by index: true in schema, so we don't need to add them again

// Pre-save middleware to update lastUsedAt
pushTokenSchema.pre('save', function (next) {
  if (this.isNew || this.isModified('token')) {
    this.lastUsedAt = new Date();
    // Set expiration to 90 days from now if not set
    if (!this.expiresAt) {
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + 90);
      this.expiresAt = expirationDate;
    }
  }
  next();
});

// Static method to get active tokens for a user
pushTokenSchema.statics.getActiveTokensForUser = async function (userId) {
  return this.find({
    userId,
    isActive: true,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } },
    ],
  });
};

// Static method to get active tokens for a merchant
pushTokenSchema.statics.getActiveTokensForMerchant = async function (merchantId) {
  return this.find({
    merchantId,
    isActive: true,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } },
    ],
  });
};

// Static method to merge tokens on login (onLoginMerge: true)
pushTokenSchema.statics.mergeAnonymousTokens = async function (deviceId, userId) {
  // Find all anonymous tokens for this device
  const anonymousTokens = await this.find({
    deviceId,
    userId: null,
    isActive: true,
  });

  // Update them to belong to the user
  if (anonymousTokens.length > 0) {
    await this.updateMany(
      { _id: { $in: anonymousTokens.map(t => t._id) } },
      { userId, lastUsedAt: new Date() }
    );
  }

  return anonymousTokens;
};

// Static method to preserve tokens on logout (onLogoutPreserve: true)
// This means we keep the tokens but clear the userId
pushTokenSchema.statics.preserveTokensOnLogout = async function (userId) {
  // Keep tokens active but remove userId association
  await this.updateMany(
    { userId, isActive: true },
    { userId: null, lastUsedAt: new Date() }
  );
};

// Static method to cleanup expired/unused tokens (autoCleanup: true)
pushTokenSchema.statics.cleanupExpiredTokens = async function () {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Find tokens that haven't been used in 90 days
  const result = await this.updateMany(
    {
      $or: [
        { expiresAt: { $lt: new Date() } },
        { lastUsedAt: { $lt: ninetyDaysAgo } },
      ],
      isActive: true,
    },
    { isActive: false }
  );

  return result;
};

// Instance method to refresh expiration
pushTokenSchema.methods.refreshExpiration = function () {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + 90);
  this.expiresAt = expirationDate;
  this.lastUsedAt = new Date();
  return this.save();
};

const PushToken = mongoose.model('PushToken', pushTokenSchema);
export default PushToken;
