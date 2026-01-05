import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: [0.01, 'Price must be greater than 0'] },
  discountPrice: { type: Number, default: 0 },
  sizes: { type: [String], enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'xxxl'] },
  stock: { type: Number, required: true, min: [0, 'Stock cannot be negative'] },
  isActive: { type: Boolean, default: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  images: {
    type: [String],
    required: true,
    validate: {
      validator: (value) => value.length > 0,
      message: 'At least one image is required',
    },
  },
  reviews: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Review',
  }],
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  merchant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Merchant',
    default: null,
  },
}, {
  timestamps: true,
});

// Indexes for frequently queried fields
productSchema.index({ category: 1 }); // For category filtering
productSchema.index({ isActive: 1 }); // For active products filtering
productSchema.index({ merchant: 1 }); // For merchant filtering
productSchema.index({ name: 'text', description: 'text' }); // Text search index
productSchema.index({ createdAt: -1 }); // For sorting by newest
productSchema.index({ price: 1 }); // For price sorting/filtering
productSchema.index({ averageRating: -1 }); // For rating sorting

// Compound indexes for common query patterns
productSchema.index({ category: 1, isActive: 1 }); // Active products in category
productSchema.index({ merchant: 1, isActive: 1 }); // Merchant's active products
productSchema.index({ merchant: 1, category: 1 }); // Merchant products by category
productSchema.index({ merchant: 1, createdAt: -1 }); // Merchant products sorted by newest
productSchema.index({ category: 1, createdAt: -1 }); // Category products sorted by newest
productSchema.index({ isActive: 1, createdAt: -1 }); // Active products sorted by newest
productSchema.index({ isActive: 1, averageRating: -1 }); // Active products sorted by rating

const Product = mongoose.model('Product', productSchema);

export default Product;
