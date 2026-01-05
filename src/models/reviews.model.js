import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
    },
    rating: {
        type: Number,
        required: true,
        min: [1, 'Rating must be at least 1'],
        max: [5, 'Rating must be at most 5'],
    },
    comment: {
        type: String,
        required: true,
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

reviewSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Indexes for frequently queried fields
reviewSchema.index({ product: 1 }); // For filtering reviews by product
reviewSchema.index({ user: 1 }); // For filtering reviews by user
reviewSchema.index({ createdAt: -1 }); // For sorting by newest
reviewSchema.index({ rating: -1 }); // For sorting by rating

// Compound indexes for common query patterns
reviewSchema.index({ product: 1, createdAt: -1 }); // Product reviews sorted by newest
reviewSchema.index({ product: 1, rating: -1 }); // Product reviews sorted by rating
reviewSchema.index({ user: 1, createdAt: -1 }); // User reviews sorted by newest
reviewSchema.index({ product: 1, user: 1 }, { unique: true }); // One review per user per product

const Review = mongoose.model('Review', reviewSchema);

export default Review;


