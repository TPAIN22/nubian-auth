import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import { isAdmin } from '../middleware/auth.middleware.js';
import {
  listAllCurrencies,
  updateManualRate,
  toggleCurrencyActive,
  getExchangeRateStatus,
} from '../controllers/currency.admin.controller.js';

const router = Router();

// All routes require admin
router.use(requireAuth(), isAdmin);

// GET  /api/admin/currencies            — list all with current rates
router.get('/', listAllCurrencies);

// GET  /api/admin/currencies/rates      — exchange rate DB status (age, missing, etc.)
router.get('/rates', getExchangeRateStatus);

// PATCH /api/admin/currencies/:code/manual-rate  — set SDG or any unsupported currency rate
// Body: { manualRate: 650 }
router.patch('/:code/manual-rate', updateManualRate);

// PATCH /api/admin/currencies/:code/toggle — enable/disable a currency
// Body: { isActive: true }
router.patch('/:code/toggle', toggleCurrencyActive);

export default router;
