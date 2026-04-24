import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  rating: {
    type: Number,
    required: true,
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating must be at most 5'],
  },
  comment:   { type: String, required: true, maxlength: 2000 },
  // Allows hiding spam/reported reviews without permanently deleting them.
  // Deleted reviews must also trigger averageRating recalculation.
  isVisible: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// ── Indexes ──────────────────────────────────────────────────────────────────
reviewSchema.index({ product: 1, createdAt: -1 });
reviewSchema.index({ product: 1, rating: -1 });
reviewSchema.index({ user: 1,    createdAt: -1 });
reviewSchema.index({ product: 1, user: 1 }, { unique: true }); // one review per user per product

// ── Rating recalculation ─────────────────────────────────────────────────────
async function recalcProductRating(productId) {
  if (!productId) return;
  const [agg] = await mongoose.model('Review').aggregate([
    { $match: { product: productId, isVisible: true } },
    { $group: { _id: null, avg: { $avg: '$rating' } } },
  ]);
  await mongoose.model('Product').findByIdAndUpdate(productId, {
    averageRating: agg ? Math.round(agg.avg * 10) / 10 : 0,
  });
}

reviewSchema.post('save', function () {
  recalcProductRating(this.product).catch(() => {});
});

reviewSchema.post('findOneAndDelete', function (doc) {
  if (doc) recalcProductRating(doc.product).catch(() => {});
});

const Review = mongoose.model('Review', reviewSchema);
export default Review;
