import express from 'express';
import {
  updateOrderStatus,
  getUserOrders,
  createOrder,
  getOrders,
  getOrderById,
  getMerchantOrders,
  getMerchantOrderStats,
} from '../controllers/order.controller.js';
import { isAuthenticated , isAdmin} from "../middleware/auth.middleware.js";
import { isApprovedMerchant } from '../middleware/merchant.middleware.js';
import { validateOrderStatusUpdate, validateOrderCreate } from '../middleware/validators/order.validator.js';
import { validateObjectId } from '../middleware/validation.middleware.js';
import { validateStatusFilter } from '../middleware/validators/query.validator.js';

const router = express.Router();

router.get('/admin', isAuthenticated, isAdmin, getOrders);

// Merchant routes - validate status query parameter
router.get('/merchant/my-orders', isAuthenticated, isApprovedMerchant, validateStatusFilter(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']), getMerchantOrders);
router.get('/merchant/stats', isAuthenticated, isApprovedMerchant, getMerchantOrderStats);

// استرجاع طلبات المستخدم الحالية
router.get('/my-orders', isAuthenticated, getUserOrders);
// استرجاع تفاصيل طلب معين بناءً على المعرف
router.get('/:id', isAuthenticated, ...validateObjectId('id'), getOrderById);

// إنشاء طلب جديد
router.post('/', isAuthenticated, validateOrderCreate, createOrder);
router.patch('/:id/status', isAuthenticated, isAdmin, ...validateObjectId('id'), validateOrderStatusUpdate, updateOrderStatus);

export default router;
