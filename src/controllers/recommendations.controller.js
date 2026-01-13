// controllers/recommendations.controller.js
import { getAuth } from '@clerk/express';
import { sendSuccess, sendError, sendNotFound } from '../lib/response.js';
import logger from '../lib/logger.js';
import {
  getHomeRecommendations,
  getProductRecommendations,
  getCartRecommendations,
  getUserRecommendations,
} from '../services/recommendation.service.js';

/**
 * Enrich products with calculated fields (hasStock, discount, finalPrice)
 * This matches the enrichment done in home.controller.js
 */
function enrichProducts(products) {
  if (!Array.isArray(products)) return [];
  
  return products.map(product => {
    // Use smart pricing: finalPrice > discountPrice > price
    const finalPrice = product.finalPrice || product.discountPrice || product.price || 0;
    const merchantPrice = product.merchantPrice || product.price || 0;
    const originalPrice = merchantPrice;
    
    // Calculate discount percentage (if finalPrice is less than merchantPrice, it's a discount)
    // Otherwise, calculate based on legacy discountPrice
    let discount = 0;
    if (product.discountPrice && product.discountPrice > 0 && merchantPrice > product.discountPrice) {
      discount = Math.round(((merchantPrice - product.discountPrice) / merchantPrice) * 100);
    } else if (finalPrice < merchantPrice) {
      discount = Math.round(((merchantPrice - finalPrice) / merchantPrice) * 100);
    }

    // Check if product has available stock
    const hasStock = product.stock > 0 || 
      (product.variants && product.variants.some(v => v.stock > 0 && v.isActive !== false));

    return {
      ...product,
      discount,
      hasStock,
      finalPrice: finalPrice, // Smart pricing final price
      merchantPrice: merchantPrice, // Base merchant price
      originalPrice: originalPrice, // For display
      // Include pricing breakdown
      pricingBreakdown: {
        merchantPrice: merchantPrice,
        nubianMarkup: product.nubianMarkup || 10,
        dynamicMarkup: product.dynamicMarkup || 0,
        finalPrice: finalPrice,
      }
    };
  });
}

/**
 * Get home page recommendations
 * GET /api/recommendations/home
 */
export const getHomeRecommendationsController = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    const recommendations = await getHomeRecommendations(userId || null);
    
    // Enrich all product arrays with calculated fields
    const enrichedRecommendations = {
      forYou: enrichProducts(recommendations.forYou),
      trending: enrichProducts(recommendations.trending),
      flashDeals: enrichProducts(recommendations.flashDeals),
      newArrivals: enrichProducts(recommendations.newArrivals),
      brandsYouLove: enrichProducts(recommendations.brandsYouLove),
    };
    
    return sendSuccess(res, {
      data: enrichedRecommendations,
      message: 'Home recommendations retrieved successfully',
    });
  } catch (error) {
    logger.error('Error getting home recommendations', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    return sendError(res, {
      message: 'Failed to get home recommendations',
      error: error.message,
    }, 500);
  }
};

/**
 * Get product recommendations
 * GET /api/recommendations/product/:id
 */
export const getProductRecommendationsController = async (req, res) => {
  try {
    const { id: productId } = req.params;
    const { userId } = getAuth(req);
    
    if (!productId) {
      return sendError(res, {
        message: 'Product ID is required',
      }, 400);
    }
    
    const recommendations = await getProductRecommendations(productId, userId || null);
    
    // Enrich all product arrays with calculated fields
    const enrichedRecommendations = {
      similarItems: enrichProducts(recommendations.similarItems),
      frequentlyBoughtTogether: enrichProducts(recommendations.frequentlyBoughtTogether),
      youMayAlsoLike: enrichProducts(recommendations.youMayAlsoLike),
      cheaperAlternatives: enrichProducts(recommendations.cheaperAlternatives),
      fromSameStore: enrichProducts(recommendations.fromSameStore),
    };
    
    return sendSuccess(res, {
      data: enrichedRecommendations,
      message: 'Product recommendations retrieved successfully',
    });
  } catch (error) {
    logger.error('Error getting product recommendations', {
      requestId: req.requestId,
      productId: req.params.id,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    
    if (error.message === 'Product not found') {
      return sendNotFound(res, {
        message: 'Product not found',
      });
    }
    
    return sendError(res, {
      message: 'Failed to get product recommendations',
      error: error.message,
    }, 500);
  }
};

/**
 * Get cart recommendations
 * GET /api/recommendations/cart
 */
export const getCartRecommendationsController = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return sendError(res, {
        message: 'Authentication required',
      }, 401);
    }
    
    const recommendations = await getCartRecommendations(userId);
    
    // Enrich products with calculated fields
    const enrichedRecommendations = enrichProducts(recommendations);
    
    return sendSuccess(res, {
      data: enrichedRecommendations,
      message: 'Cart recommendations retrieved successfully',
    });
  } catch (error) {
    logger.error('Error getting cart recommendations', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    return sendError(res, {
      message: 'Failed to get cart recommendations',
      error: error.message,
    }, 500);
  }
};

/**
 * Get user-specific recommendations
 * GET /api/recommendations/user/:id
 */
export const getUserRecommendationsController = async (req, res) => {
  try {
    const { id: userId } = req.params;
    const { userId: authUserId } = getAuth(req);
    
    // Users can only get their own recommendations (or admin can get any)
    // For now, allow getting own recommendations or any if authenticated
    const targetUserId = userId || authUserId;
    
    if (!targetUserId) {
      return sendError(res, {
        message: 'User ID is required',
      }, 400);
    }
    
    const recommendations = await getUserRecommendations(targetUserId);
    
    // Enrich products with calculated fields
    const enrichedRecommendations = enrichProducts(recommendations);
    
    return sendSuccess(res, {
      data: enrichedRecommendations,
      message: 'User recommendations retrieved successfully',
    });
  } catch (error) {
    logger.error('Error getting user recommendations', {
      requestId: req.requestId,
      userId: req.params.id,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    return sendError(res, {
      message: 'Failed to get user recommendations',
      error: error.message,
    }, 500);
  }
};
