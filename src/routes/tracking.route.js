import express from 'express';
import { createLimiter } from '../lib/rateLimit/index.js';
import { trackEvent, mergeSession } from '../controllers/tracking.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';

const router = express.Router();

// 30 events per minute per IP — legitimate browsing stays well under this;
// prevents bots from flooding the UserActivity collection
const eventLimiter = createLimiter({
  name: 'tracking-events',
  windowMs: 60 * 1000,
  limit: 30,
  message: 'Too many tracking events.',
});

router.post('/event',         eventLimiter, trackEvent);
router.post('/merge-session', isAuthenticated, mergeSession);

export default router;
