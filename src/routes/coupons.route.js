import express from 'express';
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

// Public routes
router.get('/available', getAvailableCoupons); // Get available coupons for recommendations
router.get('/code/:code', getCouponByCode); // Get coupon by code (for validation)
router.post('/validate', validateCoupon); // Validate coupon

// Admin routes
router.get('/', isAuthenticated, isAdmin, getCoupons); // Get all coupons with filters
router.get('/:id', isAuthenticated, isAdmin, getCouponById); // Get coupon by ID
router.get('/:id/analytics', isAuthenticated, isAdmin, getCouponAnalytics); // Get coupon analytics
router.post('/', isAuthenticated, isAdmin, createCoupon); // Create coupon
router.put('/:id', isAuthenticated, isAdmin, updateCoupon); // Update coupon
router.patch('/:id/deactivate', isAuthenticated, isAdmin, deactivateCoupon); // Deactivate coupon
router.delete('/:id', isAuthenticated, isAdmin, deleteCoupon); // Delete coupon

export default router; 