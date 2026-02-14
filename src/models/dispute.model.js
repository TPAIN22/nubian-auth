import mongoose from "mongoose";

const disputeSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      unique: true,
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order", // Assuming Order model exists
        required: true
    },
    merchantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Merchant",
        required: true
    },
    transactionId: {
      type: String, // Original transaction ref
    },
    amount: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    frozen: {
        type: Boolean,
        default: true
    },
    status: {
      type: String,
      enum: ["pending", "won", "lost", "refunded", "resolved_partial", "rejected"],
      default: "pending",
    },
    resolution: {
        type: String,
        enum: ["pending", "refund_full", "refund_partial", "rejected"],
        default: "pending"
    },
    resolutionNotes: {
      type: String,
    },
    adminDecisionNote: {
        type: String
    },
    resolvedAt: {
        type: Date
    },
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }
  },
  {
    timestamps: true,
  }
);

const Dispute = mongoose.model("Dispute", disputeSchema);
export default Dispute;
