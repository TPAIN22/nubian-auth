import express from 'express';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import { isApprovedMerchant } from '../middleware/merchant.middleware.js';
import {
  getPricingAnalytics,
  getMerchantPricingAnalytics,
  getCurrencyAnalytics,
} from '../controllers/pricingAnalytics.controller.js';
import { getAdminOverview } from '../controllers/adminAnalytics.controller.js';

const router = express.Router();

// Admin-only: platform-wide overview cards (merchants, products, orders, revenue)
router.get('/overview',           isAuthenticated, isAdmin,            getAdminOverview);

// Admin-only: full platform pricing overview (reveals markups, margins)
router.get('/pricing',            isAuthenticated, isAdmin,            getPricingAnalytics);
// Merchant-only: their own pricing analytics
router.get('/pricing/merchant',   isAuthenticated, isApprovedMerchant, getMerchantPricingAnalytics);
// Admin-only: currency-level markup/adjustment data
router.get('/pricing/currencies', isAuthenticated, isAdmin,            getCurrencyAnalytics);

export default router;
