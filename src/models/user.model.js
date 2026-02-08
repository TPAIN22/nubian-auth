// models/user.model.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  clerkId: {
    type: String,
    required: true,
    unique: true,
  },
  fullName: {
    type: String,
    required: false,
  },
  phone: {
    type: String,
    required: false,
  },
  
  address: {
    type: String,
    required: false,
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  emailAddress: {
    type: String,
    required: false,
  },
  
  // ===== CURRENCY PREFERENCES =====
  // Selected country code (references Country.code)
  countryCode: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 3,
    default: null,
  },
  // Selected currency code (references Currency.code)
  currencyCode: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 3,
    default: null,
  },
  
  // ===== USER INTELLIGENCE LAYER =====
  // Track viewed products with timestamps
  viewedProducts: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
    viewCount: {
      type: Number,
      default: 1,
    },
  }],
  
  // Track clicked products
  clickedProducts: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    clickedAt: {
      type: Date,
      default: Date.now,
    },
    clickCount: {
      type: Number,
      default: 1,
    },
  }],
  
  // Track cart events (add to cart, remove from cart)
  cartEvents: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    eventType: {
      type: String,
      enum: ['add', 'remove'],
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  }],
  
  // Track search keywords
  searchKeywords: [{
    keyword: {
      type: String,
      required: true,
      trim: true,
    },
    searchedAt: {
      type: Date,
      default: Date.now,
    },
    searchCount: {
      type: Number,
      default: 1,
    },
  }],
  
  // Track purchased categories (derived from orders)
  purchasedCategories: [{
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    purchaseCount: {
      type: Number,
      default: 1,
    },
    lastPurchasedAt: {
      type: Date,
      default: Date.now,
    },
  }],
  
  // Preferred price range (calculated from purchase history)
  preferredPriceRange: {
    min: {
      type: Number,
      default: null,
    },
    max: {
      type: Number,
      default: null,
    },
  },
  
  // Preferred sizes (from purchase history and cart)
  preferredSizes: [{
    type: String,
    trim: true,
  }],
  
  // Preferred brands (from purchase history)
  preferredBrands: [{
    type: String,
    trim: true,
  }],
  
  // Device type for personalization
  deviceType: {
    type: String,
    enum: ['mobile', 'tablet', 'desktop'],
    default: 'mobile',
  },
  
  // Last active timestamp
  lastActive: {
    type: Date,
    default: Date.now,
  },
} , {timestamps:true});

// Indexes for frequently queried fields
// Note: clerkId index is automatically created by unique: true, so we don't need to add it again
userSchema.index({ emailAddress: 1 }); // For email lookups
userSchema.index({ lastActive: -1 }); // For sorting by activity
userSchema.index({ 'viewedProducts.product': 1 }); // For product view queries
userSchema.index({ 'clickedProducts.product': 1 }); // For product click queries
userSchema.index({ 'purchasedCategories.category': 1 }); // For category preference queries

const User = mongoose.model("User", userSchema);
export default User;
