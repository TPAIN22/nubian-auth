// routes/recommendations.route.js
import express from 'express';
import {
  getHomeRecommendationsController,
  getProductRecommendationsController,
  getCartRecommendationsController,
  getUserRecommendationsController,
} from '../controllers/recommendations.controller.js';
import { validateObjectId } from '../middleware/validation.middleware.js';

const router = express.Router();

/**
 * GET /api/recommendations/home
 * Get home page recommendations (For You, Trending, Flash Deals, New Arrivals, Brands You Love)
 * Public endpoint (works without auth, but provides personalized results if authenticated)
 */
router.get('/home', getHomeRecommendationsController);

/**
 * GET /api/recommendations/product/:id
 * Get product recommendations (Similar items, Frequently bought together, etc.)
 * Public endpoint (works without auth, but provides personalized results if authenticated)
 */
router.get('/product/:id', ...validateObjectId('id'), getProductRecommendationsController);

/**
 * GET /api/recommendations/cart
 * Get cart recommendations (complementary products)
 * Requires authentication
 */
router.get('/cart', getCartRecommendationsController);

/**
 * GET /api/recommendations/user/:id
 * Get user-specific recommendations
 * Requires authentication (users can only get their own recommendations)
 */
router.get('/user/:id', ...validateObjectId('id'), getUserRecommendationsController);

export default router;
