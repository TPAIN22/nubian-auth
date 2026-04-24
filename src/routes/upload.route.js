import express from 'express';
import rateLimit from 'express-rate-limit';
import { getImageKitAuth } from '../controllers/upload.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';

const router = express.Router();

// 10 auth credential requests per minute per IP
const uploadAuthLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  message: 'Too many upload auth requests.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/imagekit-auth', uploadAuthLimiter, isAuthenticated, getImageKitAuth);

export default router;
