import mongoose from "mongoose";

const merchantSchema = new mongoose.Schema({
  clerkId: {
    type: String,
    required: true,
    unique: true,
  },
  businessName: {
    type: String,
    required: true,
  },
  businessDescription: {
    type: String,
    required: false,
  },
  businessEmail: {
    type: String,
    required: true,
  },
  businessPhone: {
    type: String,
    required: false,
  },
  businessAddress: {
    type: String,
    required: false,
  },
  isFlagged: {
    type: Boolean,
    default: false,
    index: true,
  },
  flaggedAt: {
    type: Date,
  },
  flagReason: {
      type: String,
  },
  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"],
    default: "PENDING",
    index: true,
  },
  rejectionReason: {
    type: String,
    required: false,
  },
  suspensionReason: {
    type: String,
    required: false,
  },
  suspendedAt: {
    type: Date,
    required: false,
  },
  approvedAt: {
    type: Date,
    required: false,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  // appliedAt removed — use createdAt from timestamps instead
  // Wallet / Balance
  balance: {
      type: Number,
      default: 0,
      min: 0
  },
  frozenBalance: {
      type: Number,
      default: 0,
      min: 0
  }
}, { timestamps: true });

// Indexes for frequently queried fields
// Note: clerkId index is automatically created by unique: true, so we don't need to add it again
// Note: status index is automatically created by index: true in schema, so we don't need to add it again
merchantSchema.index({ businessEmail: 1 });
merchantSchema.index({ status: 1, createdAt: -1 });
merchantSchema.index({ status: 1, approvedAt: -1 });

const Merchant = mongoose.model("Merchant", merchantSchema);
export default Merchant;

