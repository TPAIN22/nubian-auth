import express from 'express';
import {
  getAllCommissions,
  markCommissionPaid,
  getAffiliateAnalytics,
  getDailyStats,
  getMonthlyStats
} from '../controllers/adminCommission.controller.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import { validateCommissionPay } from '../middleware/validators/affiliate.validator.js';

const router = express.Router();

// All routes here require Admin privileges
router.use(isAuthenticated, isAdmin);

// Management
router.get('/', getAllCommissions);
router.patch('/:id/pay', validateCommissionPay, markCommissionPaid);

// Analytics
router.get('/analytics', getAffiliateAnalytics);
router.get('/stats/daily', getDailyStats);
router.get('/stats/monthly', getMonthlyStats);

export default router;
