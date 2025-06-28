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
}, {
  timestamps: true,
});

const Product = mongoose.model('Product', productSchema);

export default Product;
