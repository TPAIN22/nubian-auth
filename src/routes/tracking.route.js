import express from 'express';
import rateLimit from 'express-rate-limit';
import { trackEvent, mergeSession } from '../controllers/tracking.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';

const router = express.Router();

// 30 events per minute per IP — legitimate browsing stays well under this;
// prevents bots from flooding the UserActivity collection
const eventLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  message: 'Too many tracking events.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/event',         eventLimiter, trackEvent);
router.post('/merge-session', isAuthenticated, mergeSession);

export default router;
