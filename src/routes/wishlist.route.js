import express from 'express';
import { getWishlist, addToWishlist, removeFromWishlist } from '../controllers/wishlist.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import { validateObjectId, handleValidationErrors } from '../middleware/validation.middleware.js';

const router = express.Router();

router.get('/', isAuthenticated, getWishlist);

router.post('/:productId',
  isAuthenticated,
  ...validateObjectId('productId'),
  handleValidationErrors,
  addToWishlist
);

router.delete('/:productId',
  isAuthenticated,
  ...validateObjectId('productId'),
  handleValidationErrors,
  removeFromWishlist
);

export default router;
