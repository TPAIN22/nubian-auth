import Coupon from '../models/coupon.model.js';

export const getCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.status(200).json(coupons);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getCouponById = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    res.status(200).json(coupon);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.create(req.body);
    res.status(201).json(coupon);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json(coupon);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteCoupon = async (req, res) => {
  try {
    await Coupon.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Coupon deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const validateCoupon = async (req, res) => {
  try {
    const { code, userId, products } = req.body;
    if (!code) {
      return res.status(400).json({ message: 'Coupon code is required' });
    }
    const coupon = await Coupon.findOne({ code, isActive: true });
    if (!coupon) {
      return res.status(404).json({ message: 'Invalid or inactive coupon code' });
    }
    if (coupon.expiresAt < new Date()) {
      return res.status(400).json({ message: 'Coupon has expired' });
    }
    if (coupon.usageLimit > 0 && coupon.usedBy.length >= coupon.usageLimit) {
      return res.status(400).json({ message: 'Coupon usage limit reached' });
    }
    if (userId) {
      const userUsedCount = coupon.usedBy.filter(u => u.toString() === userId).length;
      if (coupon.usageLimitPerUser > 0 && userUsedCount >= coupon.usageLimitPerUser) {
        return res.status(400).json({ message: 'You have already used this coupon the maximum allowed times' });
      }
    }
    if (coupon.products && coupon.products.length > 0 && products && products.length > 0) {
      const allowed = products.some(pid => coupon.products.map(id => id.toString()).includes(pid));
      if (!allowed) {
        return res.status(400).json({ message: 'Coupon is not valid for these products' });
      }
    }
    if (coupon.categories && coupon.categories.length > 0 && products && products.length > 0) {
      const allowed = products.some(prod => coupon.categories.map(id => id.toString()).includes(prod.categoryId));
      if (!allowed) {
        return res.status(400).json({ message: 'Coupon is not valid for these categories' });
      }
    }
    res.status(200).json({
      valid: true,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      expiresAt: coupon.expiresAt,
      message: 'Coupon is valid',
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 