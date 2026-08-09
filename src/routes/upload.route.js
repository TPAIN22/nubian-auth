import express from 'express';
import { createLimiter } from '../lib/rateLimit/index.js';
import { getImageKitAuth } from '../controllers/upload.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';

const router = express.Router();

// 10 auth credential requests per minute per IP
const uploadAuthLimiter = createLimiter({
  name: 'upload-auth',
  windowMs: 60 * 1000,
  limit: 10,
  message: 'Too many upload auth requests.',
});

router.get('/imagekit-auth', uploadAuthLimiter, isAuthenticated, getImageKitAuth);

export default router;
