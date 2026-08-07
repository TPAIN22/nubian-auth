import express from 'express';
import { getBanners, createBanner, updateBanner, deleteBanner } from '../controllers/banner.controller.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import { handleValidationErrors, validateObjectId } from '../middleware/validation.middleware.js';
import { validateBannerCreate, validateBannerUpdate } from '../middleware/validators/banner.validator.js';

const router = express.Router();

router.get('/', getBanners);
router.post('/', isAuthenticated, isAdmin, validateBannerCreate, handleValidationErrors, createBanner);
router.put(
  '/:id',
  isAuthenticated,
  isAdmin,
  ...validateObjectId('id'),
  validateBannerUpdate,
  handleValidationErrors,
  updateBanner,
);
router.delete('/:id', isAuthenticated, isAdmin, ...validateObjectId('id'), handleValidationErrors, deleteBanner);

export default router;
