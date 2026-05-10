import express from 'express';
import { quoteCheckout } from '../controllers/checkout.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import { requireUser } from '../middleware/requireUser.middleware.js';

const router = express.Router();

router.post('/quote', isAuthenticated, requireUser, quoteCheckout);

export default router;
