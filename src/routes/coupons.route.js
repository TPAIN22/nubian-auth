import express from 'express';
import { createLimiter } from '../lib/rateLimit/index.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import {
  getCoupons,
  getCouponById,
  getCouponByCode,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
  deactivateCoupon,
  getCouponAnalytics,
  getAvailableCoupons,
  getMerchantCoupons,
} from '../controllers/coupon.controller.js';
import { isApprovedMerchant, requireMerchantPermission } from '../middleware/merchant.middleware.js';
import { PERMISSIONS } from '../lib/merchantPermissions.js';

const router = express.Router();

// 10 validation attempts per 15 minutes per IP — prevents automated coupon brute-forcing
const couponValidateLimiter = createLimiter({
  name: 'coupon-validate',
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many coupon validation attempts, please try again later.',
});

// Authenticated-only routes — prevents unauthenticated enumeration of active codes
router.get('/available',  isAuthenticated, getAvailableCoupons);

// Merchant-scoped listing. Declared before '/:id' so the literal path wins.
router.get('/merchant/mine', isAuthenticated, isApprovedMerchant, requireMerchantPermission(PERMISSIONS.COUPONS_READ), getMerchantCoupons);
router.get('/code/:code', isAuthenticated, getCouponByCode);
router.post('/validate',  couponValidateLimiter, isAuthenticated, validateCoupon);

// Admin routes
router.get('/',               isAuthenticated, isAdmin, getCoupons);
router.get('/:id',            isAuthenticated, isAdmin, getCouponById);
router.get('/:id/analytics',  isAuthenticated, isAdmin, getCouponAnalytics);
router.post('/',              isAuthenticated, isAdmin, createCoupon);
router.put('/:id',            isAuthenticated, isAdmin, updateCoupon);
router.patch('/:id/deactivate', isAuthenticated, isAdmin, deactivateCoupon);
router.delete('/:id',         isAuthenticated, isAdmin, deleteCoupon);

export default router;
