import mongoose from "mongoose";

const appliedCouponSchema = new mongoose.Schema({
  couponId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
  code:           { type: String },
  type:           { type: String, enum: ['percentage', 'fixed'] },
  value:          { type: Number },
  // Snapshot at apply-time so the cart can recompute discount as items change
  // without re-reading the Coupon document.
  maxDiscount:    { type: Number, default: null },
  minOrderAmount: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
}, { _id: false });

const cartSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  products: [
    {
      product:  { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
      quantity: { type: Number, required: true, default: 1, min: 1 },
      size:     { type: String, default: '' },
      attributes: { type: Map, of: String, default: {} },
      variantId:  { type: mongoose.Schema.Types.ObjectId },
      unitFinalPrice:    { type: Number },
      unitMerchantPrice: { type: Number },
    },
  ],
  totalQuantity: { type: Number, default: 0 },
  // Sum of unitFinalPrice * quantity, before discount/shipping.
  subtotal:      { type: Number, default: 0 },
  discount:      { type: Number, default: 0 },
  shipping:      { type: Number, default: 0 },
  // Final amount the user pays: subtotal - discount + shipping (clamped at 0).
  totalPrice:    { type: Number, default: 0 },
  appliedCoupon: { type: appliedCouponSchema, default: null },
}, {
  timestamps: true,
  // Flatten Mongoose Maps to plain objects on serialization. Without this,
  // `cart.toObject()` keeps `attributes` as a Map, which JSON-stringifies to
  // `{}` on the wire — silently dropping every variant attribute (color,
  // size, etc.). That makes follow-up cart writes ambiguous because the
  // client can no longer round-trip the exact variant identity.
  toJSON:   { flattenMaps: true },
  toObject: { flattenMaps: true },
});

// Keep denormalized totals + breakdown in sync on every save.
cartSchema.pre('save', function (next) {
  this.totalQuantity = this.products.reduce((s, p) => s + (p.quantity || 0), 0);
  this.subtotal      = this.products.reduce(
    (s, p) => s + ((p.unitFinalPrice || 0) * (p.quantity || 0)),
    0
  );

  if (this.appliedCoupon && this.appliedCoupon.code) {
    const c = this.appliedCoupon;
    // Min-order not met → keep the coupon attached but zero the discount,
    // so it auto-reapplies when the user adds enough.
    if ((c.minOrderAmount || 0) > 0 && this.subtotal < c.minOrderAmount) {
      c.discountAmount = 0;
    } else {
      let d = c.type === 'percentage'
        ? (this.subtotal * (c.value || 0)) / 100
        : (c.value || 0);
      if (c.type === 'percentage' && c.maxDiscount != null) {
        d = Math.min(d, c.maxDiscount);
      }
      c.discountAmount = Math.max(0, Math.min(d, this.subtotal));
    }
    this.discount = c.discountAmount;
  } else {
    this.discount = 0;
  }

  this.totalPrice = Math.max(0, this.subtotal - this.discount + (this.shipping || 0));
  next();
});

cartSchema.index({ user: 1 }, { unique: true });
// Expire abandoned carts after 30 days of inactivity
cartSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const Cart = mongoose.model("Cart", cartSchema);
export default Cart;
