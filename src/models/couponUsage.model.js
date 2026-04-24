import mongoose from 'mongoose';

// Replaces the unbounded usedBy[] array that lived on the Coupon document.
// Keeping usage as a separate collection prevents the Coupon document from
// hitting the 16 MB limit on high-traffic campaigns and makes per-user
// limit checks a simple countDocuments() instead of an in-memory array scan.
const couponUsageSchema = new mongoose.Schema({
  coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true },
  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  order:  { type: mongoose.Schema.Types.ObjectId, ref: 'Order',  required: true },
}, { timestamps: true });

couponUsageSchema.index({ coupon: 1, user: 1 });
couponUsageSchema.index({ coupon: 1, createdAt: -1 });
couponUsageSchema.index({ user: 1, createdAt: -1 });

const CouponUsage = mongoose.model('CouponUsage', couponUsageSchema);
export default CouponUsage;
