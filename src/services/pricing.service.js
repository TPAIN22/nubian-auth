// services/pricing.service.js
import mongoose from 'mongoose';
import Product from '../models/product.model.js';
import Order from '../models/orders.model.js';
import User from '../models/user.model.js';
import Wishlist from '../models/wishlist.model.js';
import logger from '../lib/logger.js';

/**
 * Calculate dynamic markup for a product based on:
 * - User interactions (views, cart adds, sales in last 24h)
 * - Trending status (recent sales velocity)
 * - Demand indicators (conversion rate, favorites)
 * - Stock levels (low stock = higher markup, high stock = lower markup)
 * 
 * Dynamic markup range: 0-50% (can be overridden by admin)
 * 
 * Formula:
 * - Base: 0%
 * - Trending boost: +5% to +15% (based on sales velocity)
 * - Demand boost: +3% to +12% (based on conversion rate and favorites)
 * - Interaction boost: +2% to +10% (based on views24h and cartCount24h)
 * - Stock adjustment: -5% to +8% (low stock = +markup, high stock = -markup)
 */
export async function calculateDynamicMarkup(productId) {
  try {
    const product = await Product.findById(productId).lean();
    
    if (!product || !product.isActive || product.deletedAt) {
      return 0;
    }
    
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get 24-hour metrics
    const views24h = await getViews24h(productId, twentyFourHoursAgo);
    const cartCount24h = await getCartCount24h(productId, twentyFourHoursAgo);
    const sales24h = await getSales24h(productId, twentyFourHoursAgo);
    const favoritesCount = await getFavoritesCount(productId);
    
    // Update tracking fields
    await Product.findByIdAndUpdate(productId, {
      'trackingFields.views24h': views24h,
      'trackingFields.cartCount24h': cartCount24h,
      'trackingFields.sales24h': sales24h,
      'trackingFields.favoritesCount': favoritesCount,
    });
    
    // Calculate trending boost (0-15%)
    // Based on sales velocity in last 24h
    const trendingBoost = calculateTrendingBoost(sales24h);
    
    // Calculate demand boost (0-12%)
    // Based on conversion rate and favorites
    const conversionRate = views24h > 0 ? (sales24h / views24h) * 100 : 0;
    const demandBoost = calculateDemandBoost(conversionRate, favoritesCount);
    
    // Calculate interaction boost (0-10%)
    // Based on views and cart adds in last 24h
    const interactionBoost = calculateInteractionBoost(views24h, cartCount24h);
    
    // Calculate stock adjustment (-5% to +8%)
    // Low stock = higher markup, high stock = lower markup
    const stock = product.stock || 0;
    const stockAdjustment = calculateStockAdjustment(stock);
    
    // Calculate total dynamic markup
    const dynamicMarkup = Math.min(50, Math.max(0, 
      trendingBoost + 
      demandBoost + 
      interactionBoost + 
      stockAdjustment
    ));
    
    return Math.round(dynamicMarkup * 100) / 100; // Round to 2 decimal places
  } catch (error) {
    logger.error('Error calculating dynamic markup', {
      productId,
      error: error.message,
      stack: error.stack,
    });
    return 0; // Return 0 on error to prevent pricing issues
  }
}

/**
 * Get views in last 24 hours
 */
async function getViews24h(productId, twentyFourHoursAgo) {
  try {
    const result = await User.aggregate([
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
          'viewedProducts.lastViewed': { $gte: twentyFourHoursAgo },
        },
      },
      {
        $group: {
          _id: null,
          totalViews: { $sum: '$viewedProducts.viewCount' },
        },
      },
    ]);
    
    return result[0]?.totalViews || 0;
  } catch (error) {
    logger.error('Error getting views24h', { productId, error: error.message });
    return 0;
  }
}

/**
 * Get cart adds in last 24 hours
 */
async function getCartCount24h(productId, twentyFourHoursAgo) {
  try {
    // This would require tracking cart adds with timestamps
    // For now, we'll use a simplified approach based on current cart count
    // In production, you'd want to track cart add events with timestamps
    const cartCount = await mongoose.connection.db.collection('carts').countDocuments({
      'items.product': new mongoose.Types.ObjectId(productId),
      updatedAt: { $gte: twentyFourHoursAgo },
    });
    
    return cartCount;
  } catch (error) {
    logger.error('Error getting cartCount24h', { productId, error: error.message });
    return 0;
  }
}

/**
 * Get sales in last 24 hours
 */
async function getSales24h(productId, twentyFourHoursAgo) {
  try {
    const sales = await Order.countDocuments({
      'products.product': new mongoose.Types.ObjectId(productId),
      status: { $in: ['confirmed', 'shipped', 'delivered'] },
      createdAt: { $gte: twentyFourHoursAgo },
    });
    
    return sales;
  } catch (error) {
    logger.error('Error getting sales24h', { productId, error: error.message });
    return 0;
  }
}

/**
 * Get total favorites count
 */
async function getFavoritesCount(productId) {
  try {
    const count = await Wishlist.countDocuments({
      products: new mongoose.Types.ObjectId(productId),
    });
    
    return count;
  } catch (error) {
    logger.error('Error getting favoritesCount', { productId, error: error.message });
    return 0;
  }
}

/**
 * Calculate trending boost (0-15%)
 * Based on sales velocity in last 24h
 */
function calculateTrendingBoost(sales24h) {
  if (sales24h === 0) return 0;
  if (sales24h >= 50) return 15; // High trending
  if (sales24h >= 20) return 12; // Medium-high trending
  if (sales24h >= 10) return 8; // Medium trending
  if (sales24h >= 5) return 5; // Low trending
  return 2; // Minimal trending
}

/**
 * Calculate demand boost (0-12%)
 * Based on conversion rate and favorites
 */
function calculateDemandBoost(conversionRate, favoritesCount) {
  let boost = 0;
  
  // Conversion rate boost (0-7%)
  if (conversionRate >= 10) boost += 7;
  else if (conversionRate >= 5) boost += 5;
  else if (conversionRate >= 2) boost += 3;
  else if (conversionRate >= 1) boost += 1;
  
  // Favorites boost (0-5%)
  if (favoritesCount >= 100) boost += 5;
  else if (favoritesCount >= 50) boost += 3;
  else if (favoritesCount >= 20) boost += 2;
  else if (favoritesCount >= 10) boost += 1;
  
  return Math.min(12, boost);
}

/**
 * Calculate interaction boost (0-10%)
 * Based on views and cart adds in last 24h
 */
function calculateInteractionBoost(views24h, cartCount24h) {
  let boost = 0;
  
  // Views boost (0-6%)
  if (views24h >= 1000) boost += 6;
  else if (views24h >= 500) boost += 4;
  else if (views24h >= 200) boost += 3;
  else if (views24h >= 100) boost += 2;
  else if (views24h >= 50) boost += 1;
  
  // Cart adds boost (0-4%)
  if (cartCount24h >= 50) boost += 4;
  else if (cartCount24h >= 20) boost += 3;
  else if (cartCount24h >= 10) boost += 2;
  else if (cartCount24h >= 5) boost += 1;
  
  return Math.min(10, boost);
}

/**
 * Calculate stock adjustment (-5% to +8%)
 * Low stock = higher markup, high stock = lower markup
 */
function calculateStockAdjustment(stock) {
  if (stock === 0) return 8; // Out of stock = max markup
  if (stock <= 5) return 6; // Very low stock
  if (stock <= 10) return 4; // Low stock
  if (stock <= 20) return 2; // Medium-low stock
  if (stock <= 50) return 0; // Medium stock
  if (stock <= 100) return -2; // Medium-high stock
  if (stock <= 200) return -4; // High stock
  return -5; // Very high stock = lower markup
}

/**
 * Recalculate dynamic markup and finalPrice for all products
 * Called by cron job hourly
 */
export async function recalculateAllProductPricing() {
  try {
    logger.info('Starting dynamic pricing recalculation for all products');
    const startTime = Date.now();
    
    const products = await Product.find({
      isActive: true,
      deletedAt: null,
    }).select('_id').lean();
    
    logger.info(`Recalculating pricing for ${products.length} products`);
    
    let updated = 0;
    let errors = 0;
    
    // Process products in batches
    const batchSize = 50;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (product) => {
          try {
            const dynamicMarkup = await calculateDynamicMarkup(product._id);
            
            // Update product with new dynamicMarkup
            const productDoc = await Product.findById(product._id);
            if (productDoc) {
              productDoc.dynamicMarkup = dynamicMarkup;
              
              // Update variants with same dynamicMarkup (or calculate individually)
              if (productDoc.variants && productDoc.variants.length > 0) {
                productDoc.variants.forEach(variant => {
                  variant.dynamicMarkup = dynamicMarkup; // Use same dynamicMarkup for all variants
                });
              }
              
              // Save to trigger pre-save middleware which calculates finalPrice
              await productDoc.save();
            }
            
            updated++;
          } catch (error) {
            logger.error('Error recalculating pricing for product', {
              productId: product._id,
              error: error.message,
            });
            errors++;
          }
        })
      );
    }
    
    const duration = Date.now() - startTime;
    logger.info('Dynamic pricing recalculation completed', {
      total: products.length,
      updated,
      errors,
      durationMs: duration,
    });
    
    return { total: products.length, updated, errors, durationMs: duration };
  } catch (error) {
    logger.error('Error recalculating all product pricing', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
