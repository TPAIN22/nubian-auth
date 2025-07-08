import express from 'express';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import {
  getCoupons,
  getCouponById,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  validateCoupon
} from '../controllers/coupon.controller.js';

const router = express.Router();

router.get('/', getCoupons);
router.get('/:id', getCouponById);
router.post('/', isAuthenticated, isAdmin, createCoupon);
router.put('/:id', isAuthenticated, isAdmin, updateCoupon);
router.delete('/:id', isAuthenticated, isAdmin, deleteCoupon);
router.post('/validate', validateCoupon);

export default router; 