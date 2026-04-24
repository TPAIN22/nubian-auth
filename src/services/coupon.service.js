import Coupon from '../models/coupon.model.js';
import CouponUsage from '../models/couponUsage.model.js';
import Marketer from '../models/marketer.model.js';
import { ServiceError } from '../lib/errors.js';

class CouponService {
  /**
   * Read-only coupon validation — used by the /coupons/validate endpoint.
   * Does NOT write to the database. Returns validation result and discount preview.
   *
   * @param {string}   couponCode  - Raw coupon code from client
   * @param {ObjectId} userId      - MongoDB User _id (for per-user limit check)
   * @param {number}   orderAmount - Prospective order total in USD
   * @returns {{ valid, discountAmount, coupon, errors }}
   */
  async validateCoupon(couponCode, userId, orderAmount) {
    const code = String(couponCode || '').toUpperCase().trim();
    const result = { valid: true, discountAmount: 0, errors: [] };

    const coupon = await Coupon.findOne({ code, isActive: true });
    if (!coupon) {
      return { ...result, valid: false, errors: ['Invalid or inactive coupon code'] };
    }

    const now = new Date();
    if ((coupon.startDate || new Date(0)) > now) {
      result.valid = false;
      result.errors.push('Coupon is not yet active');
    }
    if (coupon.endDate && coupon.endDate < now) {
      result.valid = false;
      result.errors.push('Coupon has expired');
    }
    if (coupon.usageLimitGlobal !== null && coupon.usageCount >= coupon.usageLimitGlobal) {
      result.valid = false;
      result.errors.push('Coupon usage limit reached');
    }
    if (userId && coupon.usageLimitPerUser > 0) {
      const used = await CouponUsage.countDocuments({ coupon: coupon._id, user: userId });
      if (used >= coupon.usageLimitPerUser) {
        result.valid = false;
        result.errors.push('You have already used this coupon the maximum allowed times');
      }
    }
    if (orderAmount && coupon.minOrderAmount > 0 && orderAmount < coupon.minOrderAmount) {
      result.valid = false;
      result.errors.push(`Minimum order amount of ${coupon.minOrderAmount} required`);
    }

    if (result.valid) {
      result.discountAmount = coupon.calculateDiscount(orderAmount || 0);
      result.coupon = coupon;
    }

    return result;
  }

  /**
   * Atomically reserves a coupon for an order.
   * Validates date/limit/per-user constraints first (fast path), then
   * uses a single findOneAndUpdate with $expr to enforce the global limit
   * at the database level — prevents double-use under concurrent checkouts.
   *
   * Throws ServiceError on any validation failure.
   *
   * @param {string}   couponCode  - Raw coupon code from client
   * @param {ObjectId} userId      - MongoDB User _id
   * @param {number}   orderAmount - Order total before this discount
   * @returns {{ couponId, couponDetails, discountAmount }}
   */
  async reserveCoupon(couponCode, userId, orderAmount) {
    const code = String(couponCode || '').toUpperCase().trim();

    const coupon = await Coupon.findOne({ code, isActive: true });
    if (!coupon) throw new ServiceError('Invalid or inactive coupon code', 'INVALID_COUPON');

    const now = new Date();
    if ((coupon.startDate || new Date(0)) > now) {
      throw new ServiceError('Coupon is not yet active', 'COUPON_NOT_ACTIVE');
    }
    if (coupon.endDate && coupon.endDate < now) {
      throw new ServiceError('Coupon has expired', 'COUPON_EXPIRED');
    }
    if (coupon.usageLimitPerUser > 0) {
      const used = await CouponUsage.countDocuments({ coupon: coupon._id, user: userId });
      if (used >= coupon.usageLimitPerUser) {
        throw new ServiceError(
          'You have already used this coupon the maximum allowed times',
          'COUPON_USER_LIMIT'
        );
      }
    }
    if (coupon.minOrderAmount > 0 && orderAmount < coupon.minOrderAmount) {
      throw new ServiceError(
        `Minimum order amount of ${coupon.minOrderAmount} required`,
        'COUPON_MIN_ORDER'
      );
    }

    const discountAmount = coupon.calculateDiscount(orderAmount);
    const usageLimit = coupon.usageLimitGlobal;

    // Atomic: only succeeds if global limit not yet reached
    const reserved = await Coupon.findOneAndUpdate(
      {
        _id: coupon._id,
        isActive: true,
        ...(usageLimit > 0 && { $expr: { $lt: ['$usageCount', usageLimit] } }),
      },
      { $inc: { usageCount: 1, totalOrders: 1, totalDiscountGiven: discountAmount } },
      { new: true }
    );
    if (!reserved) {
      throw new ServiceError('Coupon usage limit reached', 'COUPON_EXHAUSTED');
    }

    return {
      couponId: reserved._id,
      couponDetails: {
        code:           reserved.code,
        type:           reserved.type,
        value:          reserved.value,
        discountAmount,
      },
      discountAmount,
    };
  }

  /**
   * Look up an active marketer by code and return the discount amount they offer.
   * Returns 0 if the code is invalid or the marketer is inactive.
   *
   * @param {string} marketerCode
   * @param {number} totalAmount  - Order total before this discount
   * @returns {number}            - Discount amount in USD
   */
  async getMarketerDiscount(marketerCode, totalAmount) {
    const code = String(marketerCode || '').toUpperCase().trim();
    const marketer = await Marketer.findOne({ code, status: 'active' }).select('discountRate');
    if (!marketer) return 0;
    return Math.min(totalAmount * marketer.discountRate, totalAmount);
  }
}

export default new CouponService();
