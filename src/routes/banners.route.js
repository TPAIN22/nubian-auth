import express from 'express';
import { getBanners, createBanner, updateBanner, deleteBanner } from '../controllers/banner.controller.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', getBanners);
router.post('/', isAuthenticated, isAdmin, createBanner);
router.put('/:id', isAuthenticated, isAdmin, updateBanner);
router.delete('/:id', isAuthenticated, isAdmin, deleteBanner);

export default router; 