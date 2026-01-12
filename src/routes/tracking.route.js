// routes/tracking.route.js
import express from 'express';
import { trackEvent, mergeSession } from '../controllers/tracking.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';

const router = express.Router();

// Public endpoint - tracking works for guests and logged-in users
router.post('/event', trackEvent);

// Protected endpoint - merge session on login
router.post('/merge-session', isAuthenticated, mergeSession);

export default router;
