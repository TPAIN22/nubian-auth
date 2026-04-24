import express from 'express';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import {
  getHomeRecommendationsController,
  getProductRecommendationsController,
  getCartRecommendationsController,
  getUserRecommendationsController,
} from '../controllers/recommendations.controller.js';
import { validateObjectId, handleValidationErrors } from '../middleware/validation.middleware.js';

const router = express.Router();

// Public — works without auth, personalised when authenticated
router.get('/home', getHomeRecommendationsController);
router.get('/product/:id', ...validateObjectId('id'), handleValidationErrors, getProductRecommendationsController);

// Requires auth — reads the authenticated user's cart / purchase history
router.get('/cart',     isAuthenticated, getCartRecommendationsController);
// Requires auth — controller must verify req.auth.userId matches the requested :id
router.get('/user/:id', isAuthenticated, ...validateObjectId('id'), handleValidationErrors, getUserRecommendationsController);

export default router;
