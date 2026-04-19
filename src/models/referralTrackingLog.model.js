import mongoose from "mongoose";

const referralTrackingLogSchema = new mongoose.Schema({
  referralCode: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    index: true,
  },
  ip: {
    type: String,
    required: true,
    index: true,
  },
  deviceId: {
    type: String,
    default: null,
    index: true,
  },
  userAgent: {
    type: String,
    default: null,
  },
  platform: {
    type: String,
    enum: ['web', 'ios', 'android'],
    default: 'web',
  },
  userId: {
    type: String, // Clerk ID if logged in
    default: null,
    index: true,
  },
  sessionId: {
    type: String,
    default: null,
    index: true,
  },
  converted: {
    type: Boolean,
    default: false,
    index: true,
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null,
  },
  fraudScore: {
    type: Number,
    default: 0,
    index: true,
  },
  flagged: {
    type: Boolean,
    default: false,
    index: true,
  },
  flagReasons: [{
    type: String,
    trim: true,
  }],
  // AI-ready behavior data
  behaviorData: {
    timeOnSite: {
      type: Number,
      default: 0,
    },
    pagesVisited: {
      type: Number,
      default: 0,
    },
    referrerUrl: {
      type: String,
      default: null,
    },
  },
}, { timestamps: true });

// Compound indexes for fraud detection
referralTrackingLogSchema.index({ ip: 1, referralCode: 1, createdAt: -1 });
referralTrackingLogSchema.index({ deviceId: 1, referralCode: 1, createdAt: -1 });
referralTrackingLogSchema.index({ referralCode: 1, createdAt: -1 });

// TTL index: auto-delete after 180 days to keep database size manageable
referralTrackingLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

const ReferralTrackingLog = mongoose.model('ReferralTrackingLog', referralTrackingLogSchema);

export default ReferralTrackingLog;
