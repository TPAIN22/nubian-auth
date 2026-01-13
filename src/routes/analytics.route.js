// routes/analytics.route.js
import express from 'express';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import {
  getPricingAnalytics,
  getMerchantPricingAnalytics,
} from '../controllers/pricingAnalytics.controller.js';

const router = express.Router();

// Admin pricing analytics
router.get('/pricing', isAuthenticated, getPricingAnalytics);

// Merchant pricing analytics
router.get('/pricing/merchant', isAuthenticated, getMerchantPricingAnalytics);

export default router;
