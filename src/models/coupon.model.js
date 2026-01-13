import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  code: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true,
    uppercase: true, // Store codes in uppercase for consistency
  },
  type: { 
    type: String, 
    enum: ['percentage', 'fixed'], 
    required: true,
    default: 'percentage',
  },
  value: { 
    type: Number, 
    required: true,
    min: 0,
  },
  minOrderAmount: { 
    type: Number, 
    default: 0,
    min: 0,
  },
  maxDiscount: { 
    type: Number, 
    default: null, // null means no maximum discount limit
    min: 0,
  },
  startDate: { 
    type: Date, 
    required: true,
    default: Date.now,
  },
  endDate: { 
    type: Date, 
    required: true,
  },
  usageLimitPerUser: { 
    type: Number, 
    default: 1,
    min: 0, // 0 means unlimited per user
  },
  usageLimitGlobal: { 
    type: Number, 
    default: null, // null means unlimited globally
    min: 0,
  },
  usedBy: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  usageCount: {
    type: Number,
    default: 0,
  },
  applicableProducts: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product' 
  }],
  applicableCategories: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Category' 
  }],
  applicableMerchants: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Merchant' 
  }],
  isActive: { 
    type: Boolean, 
    default: true 
  },
  // Analytics fields
  totalDiscountGiven: {
    type: Number,
    default: 0,
  },
  totalOrders: {
    type: Number,
    default: 0,
  },
  // Legacy fields for backward compatibility
  discountType: { type: String, enum: ['percentage', 'fixed'] },
  discountValue: { type: Number },
  expiresAt: { type: Date },
  usageLimit: { type: Number },
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
}, {
  timestamps: true,
});

// Pre-save middleware for validation and data sync
couponSchema.pre('save', function(next) {
  // Sync legacy fields for backward compatibility
  if (!this.discountType && this.type) {
    this.discountType = this.type;
  }
  if (!this.discountValue && this.value !== undefined) {
    this.discountValue = this.value;
  }
  if (!this.expiresAt && this.endDate) {
    this.expiresAt = this.endDate;
  }
  if (!this.usageLimit && this.usageLimitGlobal !== undefined) {
    this.usageLimit = this.usageLimitGlobal;
  }
  if (!this.products && this.applicableProducts) {
    this.products = this.applicableProducts;
  }
  if (!this.categories && this.applicableCategories) {
    this.categories = this.applicableCategories;
  }
  
  // Validate dates
  if (this.startDate && this.endDate && this.startDate > this.endDate) {
    return next(new Error('Start date must be before or equal to end date'));
  }
  
  // Validate value
  if (this.value < 0) {
    return next(new Error('Coupon value cannot be negative'));
  }
  
  // Validate percentage discount
  if (this.type === 'percentage' && this.value > 100) {
    return next(new Error('Percentage discount cannot exceed 100%'));
  }
  
  // Uppercase code
  if (this.code) {
    this.code = this.code.toUpperCase().trim();
  }
  
  next();
});

// Virtual for checking if coupon is expired
couponSchema.virtual('isExpired').get(function() {
  return this.endDate < new Date();
});

// Virtual for checking if coupon is currently valid (within date range)
couponSchema.virtual('isCurrentlyValid').get(function() {
  const now = new Date();
  return this.isActive && 
         this.startDate <= now && 
         this.endDate >= now &&
         (this.usageLimitGlobal === null || this.usageCount < this.usageLimitGlobal);
});

// Method to check if user can use this coupon
couponSchema.methods.canBeUsedBy = function(userId) {
  if (!this.isCurrentlyValid) return false;
  
  if (this.usageLimitPerUser > 0 && userId) {
    const userUsageCount = this.usedBy.filter(
      id => id.toString() === userId.toString()
    ).length;
    if (userUsageCount >= this.usageLimitPerUser) {
      return false;
    }
  }
  
  return true;
};

// Method to calculate discount amount
couponSchema.methods.calculateDiscount = function(orderAmount) {
  if (orderAmount < this.minOrderAmount) {
    return 0;
  }
  
  let discountAmount = 0;
  
  if (this.type === 'percentage') {
    discountAmount = (orderAmount * this.value) / 100;
    // Apply max discount limit if set
    if (this.maxDiscount !== null && discountAmount > this.maxDiscount) {
      discountAmount = this.maxDiscount;
    }
  } else {
    discountAmount = this.value;
  }
  
  // Ensure discount doesn't exceed order amount
  return Math.min(discountAmount, orderAmount);
};

// Indexes for frequently queried fields
couponSchema.index({ isActive: 1, endDate: 1 }); // Active and non-expired coupons
couponSchema.index({ code: 1, isActive: 1 }); // Coupon lookup with active status
couponSchema.index({ startDate: 1, endDate: 1 }); // Date range queries
couponSchema.index({ applicableProducts: 1 }); // Product-specific coupons
couponSchema.index({ applicableCategories: 1 }); // Category-specific coupons
couponSchema.index({ applicableMerchants: 1 }); // Merchant-specific coupons

const Coupon = mongoose.model('Coupon', couponSchema);

export default Coupon; 