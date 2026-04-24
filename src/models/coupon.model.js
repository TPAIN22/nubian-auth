import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
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
  minOrderAmount: { type: Number, default: 0, min: 0 },
  maxDiscount:    { type: Number, default: null, min: 0 },

  startDate: { type: Date, required: true, default: Date.now },
  endDate:   { type: Date, required: true },

  usageLimitPerUser: { type: Number, default: 1, min: 0 },
  usageLimitGlobal:  { type: Number, default: null, min: 0 },

  // usedBy array removed — replaced by CouponUsage collection.
  // Per-user limit checks: CouponUsage.countDocuments({ coupon, user })
  // Global usage:          coupon.usageCount (incremented atomically via $inc)
  usageCount: { type: Number, default: 0 },

  applicableProducts:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  applicableCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  applicableMerchants:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Merchant' }],

  isActive: { type: Boolean, default: true },

  // Analytics
  totalDiscountGiven: { type: Number, default: 0 },
  totalOrders:        { type: Number, default: 0 },
}, { timestamps: true });

couponSchema.pre('save', function (next) {
  if (this.code) this.code = this.code.toUpperCase().trim();

  if (this.startDate && this.endDate && this.startDate > this.endDate) {
    return next(new Error('Start date must be before or equal to end date'));
  }
  if (this.value < 0) {
    return next(new Error('Coupon value cannot be negative'));
  }
  if (this.type === 'percentage' && this.value > 100) {
    return next(new Error('Percentage discount cannot exceed 100%'));
  }
  next();
});

couponSchema.virtual('isExpired').get(function () {
  return this.endDate < new Date();
});

couponSchema.virtual('isCurrentlyValid').get(function () {
  const now = new Date();
  return (
    this.isActive &&
    this.startDate <= now &&
    this.endDate >= now &&
    (this.usageLimitGlobal === null || this.usageCount < this.usageLimitGlobal)
  );
});

couponSchema.methods.calculateDiscount = function (orderAmount) {
  if (orderAmount < this.minOrderAmount) return 0;

  let discount = this.type === 'percentage'
    ? (orderAmount * this.value) / 100
    : this.value;

  if (this.type === 'percentage' && this.maxDiscount !== null) {
    discount = Math.min(discount, this.maxDiscount);
  }

  return Math.min(discount, orderAmount);
};

couponSchema.index({ isActive: 1, endDate: 1 });
couponSchema.index({ code: 1, isActive: 1 });
couponSchema.index({ startDate: 1, endDate: 1 });
couponSchema.index({ applicableProducts: 1 });
couponSchema.index({ applicableCategories: 1 });
couponSchema.index({ applicableMerchants: 1 });

const Coupon = mongoose.model('Coupon', couponSchema);
export default Coupon;
