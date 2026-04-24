import mongoose from "mongoose";

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
  totalPrice:    { type: Number, default: 0 },
}, { timestamps: true }); // updatedAt maintained automatically — required for TTL correctness

// Keep denormalized totals in sync on every save
cartSchema.pre('save', function (next) {
  this.totalQuantity = this.products.reduce((s, p) => s + (p.quantity || 0), 0);
  this.totalPrice    = this.products.reduce((s, p) => s + ((p.unitFinalPrice || 0) * (p.quantity || 0)), 0);
  next();
});

cartSchema.index({ user: 1 }, { unique: true });
// Expire abandoned carts after 30 days of inactivity
cartSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const Cart = mongoose.model("Cart", cartSchema);
export default Cart;
