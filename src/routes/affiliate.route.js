import express from 'express';
import {
  registerAsMarketer,
  getMyProfile,
  getMyStats,
  getMyCommissions
} from '../controllers/affiliate.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import { validateAffiliateRegistration } from '../middleware/validators/affiliate.validator.js';

const router = express.Router();

// Publicly accessible but require authentication to act
router.post('/register', isAuthenticated, validateAffiliateRegistration, registerAsMarketer);

// Marketer specific actions
router.get('/me', isAuthenticated, getMyProfile);
router.get('/stats', isAuthenticated, getMyStats);
router.get('/commissions', isAuthenticated, getMyCommissions);

export default router;
