import mongoose from "mongoose";

const marketerSchema = new mongoose.Schema({
  // Link to User document
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    // Removed unique to support legacy data updates
  },
  clerkId: {
    type: String,
    // Removed unique to support legacy data updates
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  code: {
    type: String,
    unique: true,
    required: true,
    uppercase: true,
    trim: true,
  },
  commissionRate: {
    type: Number,
    default: parseFloat(process.env.DEFAULT_COMMISSION_RATE) || 0.10, // 10%
    min: 0,
    max: 1,
  },
  discountRate: {
    type: Number,
    default: parseFloat(process.env.DEFAULT_DISCOUNT_RATE) || 0.10, // 10%
    min: 0,
    max: 1,
  },

  // ===== EARNINGS TRACKING =====
  totalEarnings: {
    type: Number,
    default: 0,
  },
  pendingEarnings: {
    type: Number,
    default: 0,
  },
  paidEarnings: {
    type: Number,
    default: 0,
  },

  // ===== PERFORMANCE METRICS =====
  totalOrders: {
    type: Number,
    default: 0,
  },
  totalClicks: {
    type: Number,
    default: 0,
  },

  // ===== STATUS & MODERATION =====
  status: {
    type: String,
    enum: ['active', 'suspended', 'pending'],
    default: 'active',
  },

  // ===== FRAUD DETECTION (AI-ready) =====
  fraudScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  suspiciousFlags: [{
    type: String,
    trim: true,
  }],

  // ===== REFERRAL LINK =====
  referralLink: {
    type: String,
    default: null,
  },

  // ===== CONTACT / PAYOUT =====
  phone: {
    type: String,
    default: null,
    trim: true,
  },
  payoutMethod: {
    type: String,
    enum: ['bankak', 'cash', 'bank_transfer', null],
    default: null,
  },
  payoutDetails: {
    type: String,
    default: null,
    trim: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

// Indexes for frequently queried fields
// Note: code, user, clerkId indexes are automatically created by unique: true
marketerSchema.index({ status: 1 });
marketerSchema.index({ createdAt: -1 });
marketerSchema.index({ totalEarnings: -1 }); // For top marketers leaderboard
marketerSchema.index({ totalOrders: -1 }); // For performance rankings
marketerSchema.index({ fraudScore: -1 }); // For fraud monitoring

const Marketer = mongoose.model('Marketer', marketerSchema);

export default Marketer;