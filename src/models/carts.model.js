import mongoose from "mongoose";

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  products: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
      },
      quantity: {
        type: Number,
        required: true,
        default: 1,
        min: 1,
      },
      // Legacy field - kept for backward compatibility
      size: {
        type: String,
        default: '',
        required: false,
      },
      // New generic attributes field - supports any key-value pairs
      attributes: {
        type: Map,
        of: String,
        default: {},
      },
    },
  ],
  totalQuantity: {
    type: Number,
    default: 0,
  },
  totalPrice: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Indexes for frequently queried fields
cartSchema.index({ user: 1 }, { unique: true }); // Each user has one cart, frequently queried

const Cart = mongoose.model("Cart", cartSchema);
export default Cart;
