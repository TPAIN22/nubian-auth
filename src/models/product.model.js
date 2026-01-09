import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  
  // Pricing - required for simple products, optional for variant-based products
  price: { 
    type: Number, 
    required: function() {
      // Price is required if product has no variants
      return !this.variants || this.variants.length === 0;
    },
    min: [0.01, 'Price must be greater than 0'],
    default: undefined
  },
  discountPrice: { type: Number, default: 0, min: [0, 'DiscountPrice cannot be negative'] },
  
  // Stock - required for simple products, optional for variant-based products
  stock: { 
    type: Number, 
    required: function() {
      // Stock is required if product has no variants
      return !this.variants || this.variants.length === 0;
    },
    min: [0, 'Stock cannot be negative'],
    default: undefined
  },
  
  // Legacy sizes field - kept for backward compatibility
  // No longer has enum restriction - can be any string array
  sizes: { 
    type: [String], 
    default: []
  },
  
  // Legacy colors field - kept for backward compatibility
  colors: {
    type: [String],
    default: []
  },
  
  // New flexible attributes system - defines what attributes this product supports
  attributes: [{
    name: {
      type: String,
      required: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['select', 'text', 'number'],
      default: 'select',
    },
    required: {
      type: Boolean,
      default: false,
    },
    options: {
      type: [String],
      default: [],
    },
  }],
  
  // Product variants - each variant has its own price, stock, and attributes
  variants: [{
    sku: {
      type: String,
      required: true,
      trim: true,
      // SKU uniqueness will be validated at application level (not schema level)
      // because we need to check uniqueness per product, not globally
    },
    attributes: {
      type: Map,
      of: String,
      required: true,
      // Attributes must match the product's attribute definitions
    },
    price: {
      type: Number,
      required: true,
      min: [0.01, 'Variant price must be greater than 0'],
    },
    discountPrice: {
      type: Number,
      default: 0,
      min: [0, 'Variant discountPrice cannot be negative'],
    },
    stock: {
      type: Number,
      required: true,
      min: [0, 'Variant stock cannot be negative'],
    },
    images: {
      type: [String],
      default: [],
      // Variant-specific images (optional, falls back to product images)
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  }],
  
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

// Pre-save middleware to auto-populate legacy fields from variants
productSchema.pre('save', function(next) {
  // If product has variants, auto-populate sizes and colors from variants
  if (this.variants && this.variants.length > 0) {
    const sizesSet = new Set();
    const colorsSet = new Set();
    
    this.variants.forEach(variant => {
      if (variant.attributes) {
        // Convert Map to object if needed
        const attrs = variant.attributes instanceof Map 
          ? Object.fromEntries(variant.attributes) 
          : variant.attributes;
        
        // Extract size and color from attributes
        if (attrs.size) sizesSet.add(attrs.size);
        if (attrs.color) colorsSet.add(attrs.color);
        if (attrs.Color) colorsSet.add(attrs.Color); // Case-insensitive
      }
    });
    
    // Update legacy fields
    this.sizes = Array.from(sizesSet);
    this.colors = Array.from(colorsSet);
    
    // Calculate total stock from variants
    const totalStock = this.variants.reduce((sum, variant) => sum + (variant.stock || 0), 0);
    this.stock = totalStock;
  }
  
  next();
});

// Transform to JSON - ensure Map objects (variant attributes) are properly serialized
productSchema.set('toJSON', {
  transform: function(doc, ret) {
    // Convert variant attributes Map to plain object for JSON serialization
    if (ret.variants && Array.isArray(ret.variants)) {
      ret.variants = ret.variants.map(variant => {
        if (variant.attributes instanceof Map) {
          variant.attributes = Object.fromEntries(variant.attributes);
        }
        return variant;
      });
    }
    // Ensure _id is included and properly formatted
    if (ret._id) {
      ret._id = ret._id.toString();
    }
    return ret;
  }
});

// Indexes for frequently queried fields
productSchema.index({ category: 1 }); // For category filtering
productSchema.index({ isActive: 1 }); // For active products filtering
productSchema.index({ merchant: 1 }); // For merchant filtering
productSchema.index({ name: 'text', description: 'text' }); // Text search index
productSchema.index({ createdAt: -1 }); // For sorting by newest
productSchema.index({ price: 1 }); // For price sorting/filtering
productSchema.index({ averageRating: -1 }); // For rating sorting

// Variant-specific indexes
productSchema.index({ 'variants.sku': 1 }); // For SKU lookups
productSchema.index({ 'variants.isActive': 1 }); // For active variant filtering

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
