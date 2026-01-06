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
    type: String, // Clerk ID of admin who approved
    required: false,
  },
  appliedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

// Indexes for frequently queried fields
// Note: clerkId index is automatically created by unique: true, so we don't need to add it again
merchantSchema.index({ status: 1 });
merchantSchema.index({ appliedAt: -1 }); // For sorting by application date
merchantSchema.index({ businessEmail: 1 }); // For email lookups

// Compound indexes for common query patterns
merchantSchema.index({ status: 1, appliedAt: -1 }); // Merchants by status sorted by application date
merchantSchema.index({ status: 1, approvedAt: -1 }); // Approved merchants sorted by approval date

const Merchant = mongoose.model("Merchant", merchantSchema);
export default Merchant;

