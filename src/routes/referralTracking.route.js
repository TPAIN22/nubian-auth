import express from 'express';
import rateLimit from 'express-rate-limit';
import { trackReferral } from '../controllers/referralTracking.controller.js';
import { extractReferral } from '../middleware/referral.middleware.js';
import { checkReferralFraud } from '../middleware/affiliateFraud.middleware.js';
import { validateReferralTracking } from '../middleware/validators/affiliate.validator.js';

const router = express.Router();

// 20 referral clicks per 10 minutes per IP — prevents click-farming on affiliate links
const referralLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: 'Too many referral requests.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/referral',
  referralLimiter,
  validateReferralTracking,
  extractReferral,
  checkReferralFraud,
  trackReferral
);

export default router;
