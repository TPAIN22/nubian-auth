import express from 'express';
import { getHomeData } from '../controllers/home.controller.js';

const router = express.Router();

// Public route - no authentication required
router.get('/', getHomeData);

export default router;
