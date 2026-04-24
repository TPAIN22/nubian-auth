import express from 'express';
import rateLimit from 'express-rate-limit';
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
} from '../controllers/coupon.controller.js';

const router = express.Router();

// 10 validation attempts per 15 minutes per IP — prevents automated coupon brute-forcing
const couponValidateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many coupon validation attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Authenticated-only routes — prevents unauthenticated enumeration of active codes
router.get('/available',  isAuthenticated, getAvailableCoupons);
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
