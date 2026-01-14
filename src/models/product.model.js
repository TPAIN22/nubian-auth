import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  
  // ===== SMART PRICING SYSTEM =====
  // merchantPrice: The price set by the merchant (base price)
  merchantPrice: { 
    type: Number, 
    required: function() {
      // Merchant price is required if product has no variants
      return !this.variants || this.variants.length === 0;
    },
    min: [0.01, 'Merchant price must be greater than 0'],
    default: undefined
  },
  
  // nubianMarkup: Base markup percentage (default 10%)
  nubianMarkup: { 
    type: Number, 
    default: 70, 
    min: [0, 'Nubian markup cannot be negative'] 
  },
  
  // dynamicMarkup: Dynamic markup calculated based on demand, trending, stock (updated by cron job)
  dynamicMarkup: { 
    type: Number, 
    default: 0, 
    min: [0, 'Dynamic markup cannot be negative'] 
  },
  
  // finalPrice: Calculated price = merchantPrice + (merchantPrice * nubianMarkup / 100) + (merchantPrice * dynamicMarkup / 100)
  // Always >= merchantPrice
  finalPrice: { 
    type: Number, 
    min: [0, 'Final price cannot be negative'] 
  },
  
  // Legacy pricing fields - kept for backward compatibility
  // price: Maps to merchantPrice for backward compatibility
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
    // Smart pricing for variants
    price: {
      type: Number,
      required: true,
      min: [0.01, 'Variant price must be greater than 0'],
    },
    // Variant merchantPrice (base price set by merchant)
    merchantPrice: {
      type: Number,
      required: true,
      min: [0.01, 'Variant merchant price must be greater than 0'],
    },
    // Variant nubianMarkup (defaults to product nubianMarkup)
    nubianMarkup: {
      type: Number,
      default: 70,
      min: [0, 'Variant nubian markup cannot be negative'],
    },
    // Variant dynamicMarkup (calculated by cron job)
    dynamicMarkup: {
      type: Number,
      default: 0,
      min: [0, 'Variant dynamic markup cannot be negative'],
    },
    // Variant finalPrice (calculated)
    finalPrice: {
      type: Number,
      min: [0, 'Variant final price cannot be negative'],
    },
    // Legacy fields for backward compatibility
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
  
  // Ranking system fields (Admin-controlled)
  // priorityScore: Admin-assigned priority (0-100, default 0)
  // Higher values = higher priority in ranking
  priorityScore: { 
    type: Number, 
    default: 0, 
    min: [0, 'Priority score cannot be negative'],
    max: [100, 'Priority score cannot exceed 100'],
  },
  
  // featured: Admin can mark products as featured for maximum visibility
  // Featured products get a massive boost in ranking (always appear first)
  featured: { 
    type: Boolean, 
    default: false,
  },
  
  // ===== SMART COMMERCE RANKING FIELDS =====
  // Track product performance metrics
  orderCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  viewCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  favoriteCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  
  // ===== TRACKING FIELDS (24-hour metrics for dynamic pricing) =====
  trackingFields: {
    views24h: { type: Number, default: 0, min: 0 },
    cartCount24h: { type: Number, default: 0, min: 0 },
    sales24h: { type: Number, default: 0, min: 0 },
    favoritesCount: { type: Number, default: 0, min: 0 },
  },
  
  // ===== RANKING FIELDS (for visibility score calculation) =====
  rankingFields: {
    visibilityScore: { type: Number, default: 0, min: 0 },
    priorityScore: { type: Number, default: 0, min: 0 },
    featured: { type: Boolean, default: false },
    conversionRate: { type: Number, default: 0, min: 0, max: 100 },
    storeRating: { type: Number, default: 0, min: 0, max: 5 },
  },
  
  // Calculated metrics (updated by scoring service)
  conversionRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  storeRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  
  // Boost factors
  discountBoost: {
    type: Number,
    default: 0,
    min: 0,
  },
  newnessBoost: {
    type: Number,
    default: 0,
    min: 0,
  },
  
  // Final calculated visibility score
  visibilityScore: {
    type: Number,
    default: 0,
    min: 0,
    index: true, // Indexed for efficient sorting
  },
  
  // Timestamp for when score was last calculated
  scoreCalculatedAt: {
    type: Date,
    default: null,
  },
  
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
  deletedAt: {
    type: Date,
    default: null,
    index: true,
  },
}, {
  timestamps: true,
});

// Pre-save middleware to auto-populate legacy fields and calculate pricing
productSchema.pre('save', function(next) {
  // ===== PRICING CALCULATION =====
  // Calculate finalPrice for simple products
  if (!this.variants || this.variants.length === 0) {
    // For simple products: use merchantPrice if set, otherwise fallback to price
    const basePrice = this.merchantPrice || this.price || 0;
    if (basePrice > 0) {
      const nubianMarkupValue = this.nubianMarkup || 70;
      const dynamicMarkupValue = this.dynamicMarkup || 0;
      
      // Calculate finalPrice = merchantPrice + (merchantPrice * nubianMarkup / 100) + (merchantPrice * dynamicMarkup / 100)
      const nubianMarkupAmount = (basePrice * nubianMarkupValue) / 100;
      const dynamicMarkupAmount = (basePrice * dynamicMarkupValue) / 100;
      this.finalPrice = Math.max(basePrice, basePrice + nubianMarkupAmount + dynamicMarkupAmount);
      
      // Ensure finalPrice is never below merchantPrice
      if (this.finalPrice < basePrice) {
        this.finalPrice = basePrice;
      }
      
      // Sync merchantPrice with price for backward compatibility
      if (!this.merchantPrice && this.price) {
        this.merchantPrice = this.price;
      }
      // Sync price with merchantPrice if price is not set
      if (!this.price && this.merchantPrice) {
        this.price = this.merchantPrice;
      }
    }
  } else {
    // For variant-based products: calculate finalPrice for each variant
    this.variants.forEach(variant => {
      const variantBasePrice = variant.merchantPrice || variant.price || 0;
      if (variantBasePrice > 0) {
        const variantNubianMarkup = variant.nubianMarkup !== undefined ? variant.nubianMarkup : (this.nubianMarkup || 70);
        const variantDynamicMarkup = variant.dynamicMarkup || 0;
        
        // Calculate variant finalPrice
        const nubianMarkupAmount = (variantBasePrice * variantNubianMarkup) / 100;
        const dynamicMarkupAmount = (variantBasePrice * variantDynamicMarkup) / 100;
        variant.finalPrice = Math.max(variantBasePrice, variantBasePrice + nubianMarkupAmount + dynamicMarkupAmount);
        
        // Ensure variant finalPrice is never below merchantPrice
        if (variant.finalPrice < variantBasePrice) {
          variant.finalPrice = variantBasePrice;
        }
        
        // Sync variant merchantPrice with price for backward compatibility
        if (!variant.merchantPrice && variant.price) {
          variant.merchantPrice = variant.price;
        }
        // Sync variant price with merchantPrice if price is not set
        if (!variant.price && variant.merchantPrice) {
          variant.price = variant.merchantPrice;
        }
      }
    });
    
    // Calculate aggregate stock from variants
    const totalStock = this.variants.reduce((sum, variant) => sum + (variant.stock || 0), 0);
    this.stock = totalStock;
  }
  
  // ===== LEGACY FIELDS AUTO-POPULATION =====
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

// Add query helper to exclude soft-deleted products by default
productSchema.query.active = function() {
  return this.where({ deletedAt: null });
};

// Indexes for frequently queried fields
productSchema.index({ category: 1 }); // For category filtering
productSchema.index({ isActive: 1 }); // For active products filtering
productSchema.index({ merchant: 1 }); // For merchant filtering
// Note: deletedAt index is automatically created by index: true in schema, so we don't need to add it again
productSchema.index({ name: 'text', description: 'text' }); // Text search index
productSchema.index({ createdAt: -1 }); // For sorting by newest
productSchema.index({ price: 1 }); // For price sorting/filtering
productSchema.index({ averageRating: -1 }); // For rating sorting

// Variant-specific indexes
productSchema.index({ 'variants.sku': 1 }); // For SKU lookups
productSchema.index({ 'variants.isActive': 1 }); // For active variant filtering

// Ranking system indexes
productSchema.index({ featured: -1, priorityScore: -1 }); // For featured + priority sorting
productSchema.index({ priorityScore: -1 }); // For priority-based ranking
productSchema.index({ featured: -1, priorityScore: -1, createdAt: -1 }); // Compound for ranking queries

// Compound indexes for common query patterns
productSchema.index({ category: 1, isActive: 1, deletedAt: 1 }); // Active, non-deleted products in category
productSchema.index({ merchant: 1, isActive: 1, deletedAt: 1 }); // Merchant's active, non-deleted products
productSchema.index({ merchant: 1, category: 1, deletedAt: 1 }); // Merchant products by category (non-deleted)
productSchema.index({ merchant: 1, deletedAt: 1, createdAt: -1 }); // Merchant products sorted by newest (non-deleted)
productSchema.index({ category: 1, deletedAt: 1, createdAt: -1 }); // Category products sorted by newest (non-deleted)
productSchema.index({ isActive: 1, deletedAt: 1, createdAt: -1 }); // Active, non-deleted products sorted by newest
productSchema.index({ isActive: 1, deletedAt: 1, averageRating: -1 }); // Active, non-deleted products sorted by rating

// Ranking compound indexes for home page queries
productSchema.index({ isActive: 1, deletedAt: 1, featured: -1, priorityScore: -1, createdAt: -1 }); // Main ranking query index
productSchema.index({ category: 1, isActive: 1, deletedAt: 1, featured: -1, priorityScore: -1, createdAt: -1 }); // Category ranking

// Smart commerce ranking indexes
productSchema.index({ visibilityScore: -1 }); // For sorting by visibility score
productSchema.index({ isActive: 1, deletedAt: 1, visibilityScore: -1 }); // Active products by visibility
productSchema.index({ category: 1, isActive: 1, deletedAt: 1, visibilityScore: -1 }); // Category products by visibility
productSchema.index({ orderCount: -1 }); // For trending products
productSchema.index({ viewCount: -1 }); // For popular products
productSchema.index({ favoriteCount: -1 }); // For most favorited products

const Product = mongoose.model('Product', productSchema);

export default Product;
