import mongoose from "mongoose";
import { DEFAULT_NUBIAN_MARKUP } from "../lib/pricing.config.js";

const bankakApprovalSchema = new mongoose.Schema({
  status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedAt: { type: Date },
  // Clerk user id of the admin who acted — a string like "user_2ab…", never a
  // Mongo ObjectId. Typing these as ObjectId made every BANKAK approve/reject
  // throw a CastError inside order.save(), surfacing as a 500. Same convention
  // as merchant.model.js `approvedBy`.
  approvedBy: { type: String, default: null },
  rejectedAt: { type: Date },
  rejectedBy: { type: String, default: null },
  reason:     { type: String },
}, { _id: false });

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
    nubianMarkup: { type: Number, default: () => DEFAULT_NUBIAN_MARKUP },
    dynamicMarkup: { type: Number, default: 0 },
    discountPrice: { type: Number, default: 0 }, // legacy display
    originalPrice: { type: Number, default: 0 },
    discountAmount:     { type: Number, default: 0, min: 0 },
    discountPercentage: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false }
);

/**
 * Immutable delivery-address snapshot, frozen at checkout.
 *
 * An order must never depend on the shopper's saved address afterwards: they can
 * edit it, re-pin it or delete it entirely, and none of that may change where a
 * past order was sent or what a courier was told. Everything needed to deliver,
 * dispute or re-route the order is copied here once and then left alone.
 *
 * `_id: false` — this is a value object, not an entity.
 */
const addressSnapshotSchema = new mongoose.Schema(
  {
    /** Which saved address this came from. A pointer for support, never a source of truth. */
    addressId: { type: mongoose.Schema.Types.ObjectId, ref: 'Address', default: null },

    name:     { type: String, default: '' },
    phone:    { type: String, default: '' },
    whatsapp: { type: String, default: '' },

    /** GeoJSON Point, [longitude, latitude]. Absent for orders placed from a legacy address. */
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: { type: [Number] },
    },

    /**
     * The same point in human order, denormalised.
     *
     * `location` stays for $geo queries (routing, zone analytics); these two are
     * what every human-facing consumer reads — invoices, exports, courier
     * manifests, the admin dialog — so nobody has to remember that GeoJSON is
     * [lng, lat]. Null on orders placed from an un-pinned legacy address.
     */
    latitude:  { type: Number, default: null },
    longitude: { type: Number, default: null },

    formattedAddress:   { type: String, default: '' },
    placeId:            { type: String, default: '' },
    /** Open Location Code, when the provider at checkout time exposed one. */
    plusCode:           { type: String, default: '' },
    geoProvider:        { type: String, default: '' },
    countryCode:        { type: String, default: '' },
    country:            { type: String, default: '' },
    administrativeArea: { type: String, default: '' },
    city:               { type: String, default: '' },
    neighborhood:       { type: String, default: '' },
    postalCode:         { type: String, default: '' },

    street:    { type: String, default: '' },
    building:  { type: String, default: '' },
    floor:     { type: String, default: '' },
    apartment: { type: String, default: '' },
    landmark:  { type: String, default: '' },
    notes:     { type: String, default: '' },

    addressLabel:    { type: String, default: 'other' },
    locationSource:  { type: String, default: 'legacy' },
    /** high | medium | low — how reliable this address was at checkout. */
    addressConfidence: { type: String, default: 'low' },
    geocodeAccuracy: { type: String, default: 'unknown' },
    /** Reported pin accuracy in metres, null when the platform gave none. */
    locationAccuracyMeters: { type: Number, default: null },

    // Legacy hierarchy ids, carried so existing reports that join on them keep working.
    countryId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Country', default: null },
    cityId:     { type: mongoose.Schema.Types.ObjectId, ref: 'City', default: null },
    subCityId:  { type: mongoose.Schema.Types.ObjectId, ref: 'SubCity', default: null },

    snapshotAt: { type: Date, default: Date.now },
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

    totalAmount:    { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, default: 0,     min: 0 },
    finalAmount:    { type: Number, default: 0,     min: 0 },

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
    bankakApproval: { type: bankakApprovalSchema, default: () => ({}) },
    orderDate: { type: Date, default: Date.now },
    orderNumber: { type: String, unique: true },

    // Flat delivery fields. Kept required and kept populated for every order,
    // new ones included — invoices, emails, the admin table and every existing
    // report read these. `addressSnapshot` is the richer record alongside them,
    // not a replacement.
    phoneNumber: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },

    /**
     * Immutable copy of the delivery address as it was at checkout.
     * Absent on orders placed before this field existed — always read it with a
     * fallback to `address` / `city`.
     */
    addressSnapshot: { type: addressSnapshotSchema, default: undefined },

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
    referralCodeUsed: { type: String, default: null, trim: true, uppercase: true },

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
orderSchema.index({ paymentMethod: 1, paymentStatus: 1 }); // BANKAK approval queue

// Delivery geography. Sparse because orders from legacy addresses carry no pin.
// Enables driver routing, zone assignment and "orders near X" without a rescan.
orderSchema.index({ 'addressSnapshot.location': '2dsphere' }, { sparse: true });
orderSchema.index({ 'addressSnapshot.city': 1, orderDate: -1 });

const Order = mongoose.model("Order", orderSchema);
export default Order;
