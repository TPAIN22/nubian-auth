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

const Coupon = mongoose.model('Coupon', couponSchema);

export default Coupon; 