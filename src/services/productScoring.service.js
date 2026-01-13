// services/productScoring.service.js
import mongoose from 'mongoose';
import Product from '../models/product.model.js';
import Order from '../models/orders.model.js';
import Wishlist from '../models/wishlist.model.js';
import User from '../models/user.model.js';
import Merchant from '../models/merchant.model.js';
import Review from '../models/reviews.model.js';
import logger from '../lib/logger.js';

/**
 * Calculate and update visibility score for all products
 * Score formula:
 * score = (orders * 5) + (views * 1) + (favorites * 3) + (conversionRate * 10) + 
 *        (storeRating * 4) + (discountBoost) + (newnessBoost)
 */
export async function calculateProductScores() {
  try {
    logger.info('Starting product score calculation');
    const startTime = Date.now();
    
    // Get all active, non-deleted products
    const products = await Product.find({
      isActive: true,
      deletedAt: null,
    }).lean();
    
    logger.info(`Calculating scores for ${products.length} products`);
    
    let updated = 0;
    let errors = 0;
    
    // Process products in batches to avoid memory issues
    const batchSize = 100;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (product) => {
          try {
            await calculateProductScore(product._id);
            updated++;
          } catch (error) {
            logger.error('Error calculating score for product', {
              productId: product._id,
              error: error.message,
            });
            errors++;
          }
        })
      );
    }
    
    const duration = Date.now() - startTime;
    logger.info('Product score calculation completed', {
      total: products.length,
      updated,
      errors,
      durationMs: duration,
    });
    
    return { total: products.length, updated, errors, durationMs: duration };
  } catch (error) {
    logger.error('Error calculating product scores', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Calculate visibility score for a single product
 */
export async function calculateProductScore(productId) {
  try {
    const product = await Product.findById(productId)
      .populate('merchant')
      .populate('reviews')
      .lean();
    
    if (!product || !product.isActive || product.deletedAt) {
      return;
    }
    
    // Get order count (from orders collection)
    const orderCount = await Order.countDocuments({
      'products.product': productId,
      status: { $in: ['confirmed', 'shipped', 'delivered'] },
    });
    
    // Get view count (from users' viewedProducts array)
    const viewCountResult = await User.aggregate([
      {
        $match: {
          'viewedProducts.product': new mongoose.Types.ObjectId(productId),
        },
      },
      {
        $unwind: '$viewedProducts',
      },
      {
        $match: {
          'viewedProducts.product': new mongoose.Types.ObjectId(productId),
        },
      },
      {
        $group: {
          _id: null,
          totalViews: { $sum: '$viewedProducts.viewCount' },
        },
      },
    ]);
    
    const viewCount = viewCountResult[0]?.totalViews || 0;
    
    // Get favorite count (from wishlists)
    const favoriteCount = await Wishlist.countDocuments({
      products: productId,
    });
    
    // Calculate conversion rate (orders / views, max 100%)
    const conversionRate = viewCount > 0 
      ? Math.min(100, (orderCount / viewCount) * 100)
      : 0;
    
    // Get store rating (from merchant average rating or product average rating)
    let storeRating = product.averageRating || 0;
    
    // If merchant exists, try to get merchant rating from reviews
    if (product.merchant) {
      const merchantReviews = await Review.aggregate([
        {
          $lookup: {
            from: 'products',
            localField: 'product',
            foreignField: '_id',
            as: 'product',
          },
        },
        {
          $unwind: '$product',
        },
        {
          $match: {
            'product.merchant': new mongoose.Types.ObjectId(product.merchant._id),
          },
        },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$rating' },
          },
        },
      ]);
      
      if (merchantReviews[0]?.avgRating) {
        storeRating = merchantReviews[0].avgRating;
      }
    }
    
    // Calculate discount boost (0-20 points based on discount percentage)
    const effectivePrice = product.discountPrice > 0 
      ? product.discountPrice 
      : product.price;
    const discountPercentage = product.price > 0 && product.discountPrice > 0
      ? ((product.price - product.discountPrice) / product.price) * 100
      : 0;
    const discountBoost = Math.min(20, discountPercentage * 2); // Max 20 points
    
    // Calculate newness boost (0-15 points, decays over 30 days)
    const daysSinceCreation = Math.floor(
      (Date.now() - new Date(product.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    const newnessBoost = daysSinceCreation <= 30
      ? Math.max(0, 15 * (1 - daysSinceCreation / 30))
      : 0;
    
    // Get 24-hour tracking metrics (if available)
    const trackingFields = product.trackingFields || {};
    const views24h = trackingFields.views24h || 0;
    const cartCount24h = trackingFields.cartCount24h || 0;
    const sales24h = trackingFields.sales24h || 0;
    const favoritesCount24h = trackingFields.favoritesCount || favoriteCount;
    
    // Calculate trending boost based on 24h sales
    const trendingBoost = sales24h >= 50 ? 50 : sales24h >= 20 ? 30 : sales24h >= 10 ? 20 : sales24h >= 5 ? 10 : 0;
    
    // Calculate demand boost based on 24h interactions
    const demandBoost = (views24h > 0 && sales24h > 0) 
      ? Math.min(30, (sales24h / views24h) * 100) 
      : 0;
    
    // Calculate interaction boost based on 24h views and cart adds
    const interactionBoost = Math.min(20, (views24h * 0.1) + (cartCount24h * 2));
    
    // Featured boost (if product is featured)
    const featuredBoost = product.featured ? 100 : 0;
    
    // Calculate visibility score with new formula
    // visibilityScore = baseScore + trendingBoost + demandBoost + interactionBoost + featuredBoost
    const baseScore = Math.round(
      (orderCount * 5) +
      (viewCount * 1) +
      (favoriteCount * 3) +
      (conversionRate * 10) +
      (storeRating * 4) +
      discountBoost +
      newnessBoost
    );
    
    const visibilityScore = Math.round(
      baseScore +
      trendingBoost +
      demandBoost +
      interactionBoost +
      featuredBoost
    );
    
    // Update product with calculated values
    await Product.findByIdAndUpdate(productId, {
      orderCount,
      viewCount,
      favoriteCount,
      conversionRate: Math.round(conversionRate * 100) / 100, // Round to 2 decimal places
      storeRating: Math.round(storeRating * 100) / 100, // Round to 2 decimal places
      discountBoost: Math.round(discountBoost * 100) / 100,
      newnessBoost: Math.round(newnessBoost * 100) / 100,
      visibilityScore,
      scoreCalculatedAt: new Date(),
      // Update ranking fields
      'rankingFields.visibilityScore': visibilityScore,
      'rankingFields.priorityScore': product.priorityScore || 0,
      'rankingFields.featured': product.featured || false,
      'rankingFields.conversionRate': Math.round(conversionRate * 100) / 100,
      'rankingFields.storeRating': Math.round(storeRating * 100) / 100,
    });
    
    return {
      productId,
      orderCount,
      viewCount,
      favoriteCount,
      conversionRate,
      storeRating,
      discountBoost,
      newnessBoost,
      visibilityScore,
    };
  } catch (error) {
    logger.error('Error calculating product score', {
      productId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Update product score when an order is placed
 * Called after order completion
 */
export async function updateProductScoreOnOrder(productId) {
  try {
    // Recalculate score for the product
    await calculateProductScore(productId);
  } catch (error) {
    logger.error('Error updating product score on order', {
      productId,
      error: error.message,
    });
    // Don't throw - this is a background operation
  }
}

/**
 * Update product score when a product is viewed
 * Called when user views a product
 */
export async function updateProductScoreOnView(productId) {
  try {
    // Increment view count (this will be reflected in next calculation)
    // For now, we just recalculate the score
    // In production, you might want to increment a cached value
    await calculateProductScore(productId);
  } catch (error) {
    logger.error('Error updating product score on view', {
      productId,
      error: error.message,
    });
    // Don't throw - this is a background operation
  }
}

/**
 * Update product score when a product is favorited/unfavorited
 * Called when user adds/removes from wishlist
 */
export async function updateProductScoreOnFavorite(productId) {
  try {
    await calculateProductScore(productId);
  } catch (error) {
    logger.error('Error updating product score on favorite', {
      productId,
      error: error.message,
    });
    // Don't throw - this is a background operation
  }
}
