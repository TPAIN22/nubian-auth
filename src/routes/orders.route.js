import express from 'express';
import {
  updateOrderStatus,
  getUserOrders,
  createOrder,
  getOrders,
  getOrderById,
} from '../controllers/order.controller.js';
import { isAuthenticated , isAdmin} from "../middleware/auth.middleware.js";

const router = express.Router();

router.get('/admin', isAuthenticated, isAdmin, getOrders);

// استرجاع طلبات المستخدم الحالية
router.get('/my-orders', isAuthenticated, getUserOrders);

// استرجاع تفاصيل طلب معين بناءً على المعرف
router.get('/:id', isAuthenticated, getOrderById);

// إنشاء طلب جديد
router.post('/', isAuthenticated, createOrder);

router.patch('/:id/status', isAuthenticated, isAdmin, updateOrderStatus);

export default router;
