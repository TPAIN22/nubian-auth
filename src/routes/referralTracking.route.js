import express from 'express';
import { trackReferral } from '../controllers/referralTracking.controller.js';
import { extractReferral } from '../middleware/referral.middleware.js';
import { checkReferralFraud } from '../middleware/affiliateFraud.middleware.js';
import { validateReferralTracking } from '../middleware/validators/affiliate.validator.js';

const router = express.Router();

/**
 * Public referral tracking endpoint
 * Does not require authentication as it's typically called on first land
 */
router.post('/referral', 
  validateReferralTracking, 
  extractReferral, 
  checkReferralFraud, 
  trackReferral
);

export default router;
