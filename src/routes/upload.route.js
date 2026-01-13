import express from 'express';
import { getImageKitAuth } from '../controllers/upload.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get ImageKit upload authentication parameters
// This endpoint provides secure authentication for client-side uploads
router.get('/imagekit-auth', isAuthenticated, getImageKitAuth);

export default router;
