import mongoose from "mongoose";

const orderProductSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, required: false },
    quantity: { type: Number, required: true, default: 1 },

    // product attributes/variants
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    size: { type: String, required: false },

    // pricing snapshot at time of order
    price: { type: Number, required: true }, // final unit price charged
    merchantPrice: { type: Number, default: 0 },
    nubianMarkup: { type: Number, default: 10 },
    dynamicMarkup: { type: Number, default: 0 },
    discountPrice: { type: Number, default: 0 }, // legacy display
    originalPrice: { type: Number, default: 0 },
  },
  { _id: false }
);

const merchantRevenueSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: true },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    products: { type: [orderProductSchema], default: [] },

    totalAmount: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    finalAmount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"],
      default: "pending",
    },

    paymentMethod: {
      type: String,
      enum: ["CASH", "BANKAK", "CARD"],
      required: true,
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    bankakApproval: {
        status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
        approvedAt: Date,
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        rejectedAt: Date,
        rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        reason: String,
      },
    orderDate: { type: Date, default: Date.now },
    orderNumber: { type: String, unique: true },

    phoneNumber: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },

    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },
    couponDetails: {
      code: { type: String },
      type: { type: String, enum: ["percentage", "fixed"] },
      value: { type: Number },
      discountAmount: { type: Number, default: 0 },
    },

    transferProof: { type: String, default: null }, // ImageKit URL

    marketer: { type: mongoose.Schema.Types.ObjectId, ref: "Marketer", default: null },
    marketerCommission: { type: Number, default: 0 },

    merchants: [{ type: mongoose.Schema.Types.ObjectId, ref: "Merchant" }],
    merchantRevenue: { type: [merchantRevenueSchema], default: [] },

    // ===== MULTI-CURRENCY SUPPORT =====
    // Currency selected by user at checkout
    currencyCodeSelected: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 3,
      default: "USD",
    },
    // FX rate snapshot at time of order - rates are LOCKED here
    fxSnapshot: {
      // Base currency (always USD)
      base: { type: String, default: "USD" },
      // Date of the rate from provider (YYYY-MM-DD)
      date: { type: String },
      // The exchange rate used for the selected currency
      rate: { type: Number, default: 1 },
      // Provider name for audit
      provider: { type: String, default: "frankfurter" },
    },
    // Amount totals in the selected currency (for display/receipts)
    totalAmountConverted: { type: Number, default: null },
    discountAmountConverted: { type: Number, default: null },
    finalAmountConverted: { type: Number, default: null },
  },
  { timestamps: true }
);

// Indexes
orderSchema.index({ user: 1 });
orderSchema.index({ merchants: 1 });
orderSchema.index({ orderDate: -1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ user: 1, status: 1 });
orderSchema.index({ user: 1, orderDate: -1 });
orderSchema.index({ merchants: 1, status: 1 });
orderSchema.index({ merchants: 1, orderDate: -1 });
orderSchema.index({ status: 1, paymentStatus: 1 });
orderSchema.index({ status: 1, orderDate: -1 });
orderSchema.index({ marketer: 1, status: 1 });

const Order = mongoose.model("Order", orderSchema);
export default Order;
