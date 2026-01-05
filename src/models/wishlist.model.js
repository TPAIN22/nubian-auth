import mongoose from "mongoose";
const wishlistSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }]
});

// Indexes for frequently queried fields
wishlistSchema.index({ user: 1 }, { unique: true }); // Each user has one wishlist

export default mongoose.model("Wishlist", wishlistSchema); 