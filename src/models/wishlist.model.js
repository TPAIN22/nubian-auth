import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  products: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    validate: {
      validator: (v) => v.length <= 200,
      message: 'Wishlist cannot exceed 200 items',
    },
  },
}, { timestamps: true });

wishlistSchema.index({ user: 1 }, { unique: true });

export default mongoose.model("Wishlist", wishlistSchema);
