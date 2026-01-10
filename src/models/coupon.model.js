import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  discountType: { type: String, enum: ['percentage', 'fixed'], required: true }, // نوع الخصم
  discountValue: { type: Number, required: true }, // قيمة الخصم
  expiresAt: { type: Date, required: true }, // تاريخ الانتهاء
  usageLimit: { type: Number, default: 1 }, // الحد الأقصى للاستخدام الكلي
  usageLimitPerUser: { type: Number, default: 1 }, // الحد الأقصى للاستخدام لكل مستخدم
  usedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // المستخدمون الذين استخدموا الكوبون
  isActive: { type: Boolean, default: true }, // حالة التفعيل
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], // منتجات محددة
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }], // فئات محددة
}, {
  timestamps: true,
});

// Indexes for frequently queried fields
// Note: code index is automatically created by unique: true, so we don't need to add it again
couponSchema.index({ isActive: 1 }); // For filtering active coupons
couponSchema.index({ expiresAt: 1 }); // For filtering expired coupons

// Compound indexes for common query patterns
couponSchema.index({ isActive: 1, expiresAt: 1 }); // Active and non-expired coupons
couponSchema.index({ code: 1, isActive: 1 }); // Coupon lookup with active status (compound index - keep this)

const Coupon = mongoose.model('Coupon', couponSchema);

export default Coupon; 