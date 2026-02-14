import mongoose from "mongoose";

const ticketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["support", "complaint", "legal"],
      required: true,
    },
    category: {
      type: String,
      enum: [
        "order_issue",
        "payment_issue",
        "merchant_complaint",
        "product_report",
        "fraud",
        "health_risk",
        "other",
      ],
      required: true,
    },
    relatedOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    relatedProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    relatedMerchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Merchant",
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
    },
    attachments: [
      {
        type: String, // URL to the attachment
      },
    ],
    status: {
      type: String,
      enum: [
        "open",
        "under_review",
        "waiting_customer",
        "escalated",
        "resolved_refund",
        "resolved_rejected",
        "closed",
      ],
      default: "open",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    riskScore: {
      type: Number,
      default: 0,
    },
    slaDeadline: {
      type: Date,
      default: () => new Date(+new Date() + 24 * 60 * 60 * 1000), // Default 24h from now
    },
    adminNotes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient filtering by user and status
ticketSchema.index({ userId: 1, status: 1 });

const Ticket = mongoose.model("Ticket", ticketSchema);
export default Ticket;
