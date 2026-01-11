// services/recommendation.service.js
import mongoose from 'mongoose';
import Product from '../models/product.model.js';
import User from '../models/user.model.js';
import Order from '../models/orders.model.js';
import Cart from '../models/carts.model.js';
import Wishlist from '../models/wishlist.model.js';
import Merchant from '../models/merchant.model.js';
import logger from '../lib/logger.js';

/**
 * Base filter for active, non-deleted products from active merchants
 */
function getBaseFilter() {
  return {
    isActive: true,
    deletedAt: null,
    // Ensure merchant is active
    'merchant.status': 'APPROVED',
  };
}

/**
 * Get home page recommendations for a user
 * Combines: For You, Trending, Flash Deals, New Arrivals, Brands You Love
 */
export async function getHomeRecommendations(userId) {
  try {
    const user = userId ? await User.findOne({ clerkId: userId }) : null;
    
    // Base filter
    const baseFilter = getBaseFilter();
    
    // Get personalized recommendations
    const forYou = user 
      ? await getForYouRecommendations(userId, baseFilter, 20)
      : await getTrendingProducts(baseFilter, 20);
    
    // Get trending products (global popularity)
    const trending = await getTrendingProducts(baseFilter, 20);
    
    // Get flash deals (products with discounts)
    const flashDeals = await getFlashDeals(baseFilter, 20);
    
    // Get new arrivals (recently added products)
    const newArrivals = await getNewArrivals(baseFilter, 20);
    
    // Get brands you love (based on user history)
    const brandsYouLove = user
      ? await getBrandsYouLove(userId, baseFilter, 20)
      : await getTrendingProducts(baseFilter, 20);
    
    return {
      forYou: forYou.slice(0, 20),
      trending: trending.slice(0, 20),
      flashDeals: flashDeals.slice(0, 20),
      newArrivals: newArrivals.slice(0, 20),
      brandsYouLove: brandsYouLove.slice(0, 20),
    };
  } catch (error) {
    logger.error('Error getting home recommendations', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Get "For You" recommendations based on user behavior
 * Uses: similar users, category affinity, recent activity
 */
async function getForYouRecommendations(userId, baseFilter, limit = 20) {
  try {
    const user = await User.findOne({ clerkId: userId })
      .populate('viewedProducts.product', 'category')
      .populate('clickedProducts.product', 'category')
      .populate('purchasedCategories.category')
      .lean();
    
    if (!user || (!user.viewedProducts?.length && !user.purchasedCategories?.length)) {
      // Fallback to trending if no user data
      return getTrendingProducts(baseFilter, limit);
    }
    
    // Get user's preferred categories
    const categoryIds = new Set();
    user.viewedProducts?.forEach(vp => {
      if (vp.product?.category) {
        categoryIds.add(vp.product.category.toString());
      }
    });
    user.clickedProducts?.forEach(cp => {
      if (cp.product?.category) {
        categoryIds.add(cp.product.category.toString());
      }
    });
    user.purchasedCategories?.forEach(pc => {
      categoryIds.add(pc.category._id.toString());
    });
    
    const preferredCategories = Array.from(categoryIds);
    
    // Get user's viewed/clicked product IDs (to exclude from recommendations)
    const viewedProductIds = [
      ...(user.viewedProducts?.map(vp => vp.product?._id?.toString()).filter(Boolean) || []),
      ...(user.clickedProducts?.map(cp => cp.product?._id?.toString()).filter(Boolean) || []),
    ];
    
    const pipeline = [
      {
        $match: {
          ...baseFilter,
          _id: { $nin: viewedProductIds.map(id => new mongoose.Types.ObjectId(id)) },
          ...(preferredCategories.length > 0 ? {
            category: { $in: preferredCategories.map(id => new mongoose.Types.ObjectId(id)) },
          } : {}),
        },
      },
      
      // Lookup merchant to filter by status
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true },
      },
      {
        $match: {
          'merchant.status': 'APPROVED',
        },
      },
      
      // Add personalization boost based on category match
      {
        $addFields: {
          categoryBoost: {
            $cond: [
              { $in: ['$category', preferredCategories.map(id => new mongoose.Types.ObjectId(id))] },
              10,
              0,
            ],
          },
        },
      },
      
      // Sort by visibility score and personalization
      {
        $sort: {
          visibilityScore: -1,
          categoryBoost: -1,
          createdAt: -1,
        },
      },
      
      { $limit: limit },
      
      // Populate references
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
      },
    ];
    
    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting For You recommendations', { error: error.message, userId });
    return getTrendingProducts(baseFilter, limit);
  }
}

/**
 * Get trending products based on global popularity
 */
async function getTrendingProducts(baseFilter, limit = 20) {
  try {
    const pipeline = [
      {
        $match: baseFilter,
      },
      
      // Lookup merchant
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true },
      },
      {
        $match: {
          'merchant.status': 'APPROVED',
        },
      },
      
      // Sort by visibility score
      {
        $sort: {
          visibilityScore: -1,
          createdAt: -1,
        },
      },
      
      { $limit: limit },
      
      // Populate category
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
      },
    ];
    
    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting trending products', { error: error.message });
    return [];
  }
}

/**
 * Get flash deals (products with active discounts)
 */
async function getFlashDeals(baseFilter, limit = 20) {
  try {
    const pipeline = [
      {
        $match: {
          ...baseFilter,
          $or: [
            { discountPrice: { $gt: 0 } },
            { 'variants.discountPrice': { $gt: 0 } },
          ],
        },
      },
      
      // Lookup merchant
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true },
      },
      {
        $match: {
          'merchant.status': 'APPROVED',
        },
      },
      
      // Calculate discount percentage for sorting
      {
        $addFields: {
          discountPercentage: {
            $cond: [
              { $gt: ['$discountPrice', 0] },
              {
                $multiply: [
                  { $divide: ['$discountPrice', '$price'] },
                  100,
                ],
              },
              0,
            ],
          },
        },
      },
      
      // Sort by discount percentage and urgency
      {
        $sort: {
          discountPercentage: -1,
          visibilityScore: -1,
          createdAt: -1,
        },
      },
      
      { $limit: limit },
      
      // Populate category
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
      },
    ];
    
    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting flash deals', { error: error.message });
    return [];
  }
}

/**
 * Get new arrivals (recently added products)
 */
async function getNewArrivals(baseFilter, limit = 20) {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const pipeline = [
      {
        $match: {
          ...baseFilter,
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      
      // Lookup merchant
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true },
      },
      {
        $match: {
          'merchant.status': 'APPROVED',
        },
      },
      
      // Sort by creation date
      {
        $sort: {
          createdAt: -1,
          visibilityScore: -1,
        },
      },
      
      { $limit: limit },
      
      // Populate category
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
      },
    ];
    
    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting new arrivals', { error: error.message });
    return [];
  }
}

/**
 * Get brands you love (based on user purchase/view history)
 */
async function getBrandsYouLove(userId, baseFilter, limit = 20) {
  try {
    const user = await User.findOne({ clerkId: userId }).lean();
    
    if (!user?.preferredBrands?.length) {
      return getTrendingProducts(baseFilter, limit);
    }
    
    // This is a simplified version - in production, you'd match by merchant businessName
    // For now, just return trending products
    return getTrendingProducts(baseFilter, limit);
  } catch (error) {
    logger.error('Error getting brands you love', { error: error.message, userId });
    return getTrendingProducts(baseFilter, limit);
  }
}

/**
 * Get product recommendations for a specific product
 * Returns: Similar items, Frequently bought together, You may also like, Cheaper alternatives, From the same store
 */
export async function getProductRecommendations(productId, userId = null) {
  try {
    const product = await Product.findById(productId)
      .populate('merchant')
      .populate('category')
      .lean();
    
    if (!product) {
      throw new Error('Product not found');
    }
    
    const baseFilter = getBaseFilter();
    
    // Get similar items (same category, similar price range)
    const similarItems = await getSimilarItems(productId, product, baseFilter, 20);
    
    // Get frequently bought together
    const frequentlyBoughtTogether = await getFrequentlyBoughtTogether(productId, baseFilter, 20);
    
    // Get you may also like (based on user history if available)
    const youMayAlsoLike = userId
      ? await getYouMayAlsoLike(userId, productId, product, baseFilter, 20)
      : await getSimilarItems(productId, product, baseFilter, 20);
    
    // Get cheaper alternatives
    const cheaperAlternatives = await getCheaperAlternatives(productId, product, baseFilter, 20);
    
    // Get from the same store
    const fromSameStore = await getFromSameStore(productId, product.merchant?._id, baseFilter, 20);
    
    return {
      similarItems: similarItems.slice(0, 20),
      frequentlyBoughtTogether: frequentlyBoughtTogether.slice(0, 20),
      youMayAlsoLike: youMayAlsoLike.slice(0, 20),
      cheaperAlternatives: cheaperAlternatives.slice(0, 20),
      fromSameStore: fromSameStore.slice(0, 20),
    };
  } catch (error) {
    logger.error('Error getting product recommendations', {
      error: error.message,
      productId,
      userId,
    });
    throw error;
  }
}

/**
 * Get similar items (same category, similar price range)
 */
async function getSimilarItems(productId, product, baseFilter, limit = 20) {
  try {
    const priceRange = 0.5; // 50% price range
    const minPrice = product.price * (1 - priceRange);
    const maxPrice = product.price * (1 + priceRange);
    
    const pipeline = [
      {
        $match: {
          ...baseFilter,
          _id: { $ne: new mongoose.Types.ObjectId(productId) },
          category: new mongoose.Types.ObjectId(product.category._id),
          price: { $gte: minPrice, $lte: maxPrice },
        },
      },
      
      // Lookup merchant
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true },
      },
      {
        $match: {
          'merchant.status': 'APPROVED',
        },
      },
      
      // Calculate similarity score (price proximity + rating)
      {
        $addFields: {
          priceDifference: {
            $abs: { $subtract: ['$price', product.price] },
          },
          similarityScore: {
            $add: [
              { $multiply: [{ $subtract: [1, { $divide: [{ $abs: { $subtract: ['$price', product.price] } }, product.price] }] }, 10] },
              { $multiply: ['$averageRating', 2] },
            ],
          },
        },
      },
      
      // Sort by similarity
      {
        $sort: {
          similarityScore: -1,
          visibilityScore: -1,
        },
      },
      
      { $limit: limit },
      
      // Populate category
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
      },
    ];
    
    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting similar items', { error: error.message, productId });
    return [];
  }
}

/**
 * Get frequently bought together (based on order history)
 */
async function getFrequentlyBoughtTogether(productId, baseFilter, limit = 20) {
  try {
    // Find orders that contain this product
    const orders = await Order.find({
      'products.product': new mongoose.Types.ObjectId(productId),
      status: { $in: ['confirmed', 'shipped', 'delivered'] },
    }).lean();
    
    // Extract other products from these orders
    const productCounts = new Map();
    
    orders.forEach(order => {
      order.products.forEach(item => {
        const itemProductId = item.product.toString();
        if (itemProductId !== productId) {
          productCounts.set(itemProductId, (productCounts.get(itemProductId) || 0) + 1);
        }
      });
    });
    
    // Get top frequently bought together products
    const topProductIds = Array.from(productCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
    
    if (topProductIds.length === 0) {
      // Fallback to similar items if no order data
      const product = await Product.findById(productId).populate('category').lean();
      if (product) {
        return getSimilarItems(productId, product, baseFilter, limit);
      }
      return [];
    }
    
    const pipeline = [
      {
        $match: {
          ...baseFilter,
          _id: { 
            $in: topProductIds.map(id => new mongoose.Types.ObjectId(id)),
            $ne: new mongoose.Types.ObjectId(productId),
          },
        },
      },
      
      // Lookup merchant
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true },
      },
      {
        $match: {
          'merchant.status': 'APPROVED',
        },
      },
      
      // Add frequency score
      {
        $addFields: {
          frequencyScore: {
            $indexOfArray: [
              topProductIds.map(id => id.toString()),
              { $toString: '$_id' },
            ],
          },
        },
      },
      
      // Sort by frequency (inverse of index)
      {
        $sort: {
          frequencyScore: 1,
          visibilityScore: -1,
        },
      },
      
      { $limit: limit },
      
      // Populate category
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
      },
    ];
    
    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting frequently bought together', { error: error.message, productId });
    return [];
  }
}

/**
 * Get you may also like (based on user history)
 */
async function getYouMayAlsoLike(userId, productId, product, baseFilter, limit = 20) {
  try {
    const user = await User.findOne({ clerkId: userId })
      .populate('viewedProducts.product', 'category')
      .lean();
    
    if (!user?.viewedProducts?.length) {
      return getSimilarItems(productId, product, baseFilter, limit);
    }
    
    // Get categories from user's viewed products
    const categoryIds = new Set();
    user.viewedProducts.forEach(vp => {
      if (vp.product?.category) {
        categoryIds.add(vp.product.category.toString());
      }
    });
    
    const preferredCategories = Array.from(categoryIds);
    
    if (preferredCategories.length === 0) {
      return getSimilarItems(productId, product, baseFilter, limit);
    }
    
    const pipeline = [
      {
        $match: {
          ...baseFilter,
          _id: { $ne: new mongoose.Types.ObjectId(productId) },
          category: { $in: preferredCategories.map(id => new mongoose.Types.ObjectId(id)) },
        },
      },
      
      // Lookup merchant
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true },
      },
      {
        $match: {
          'merchant.status': 'APPROVED',
        },
      },
      
      // Sort by visibility score
      {
        $sort: {
          visibilityScore: -1,
          createdAt: -1,
        },
      },
      
      { $limit: limit },
      
      // Populate category
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
      },
    ];
    
    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting you may also like', { error: error.message, userId, productId });
    return getSimilarItems(productId, product, baseFilter, limit);
  }
}

/**
 * Get cheaper alternatives (same category, lower price)
 */
async function getCheaperAlternatives(productId, product, baseFilter, limit = 20) {
  try {
    const pipeline = [
      {
        $match: {
          ...baseFilter,
          _id: { $ne: new mongoose.Types.ObjectId(productId) },
          category: new mongoose.Types.ObjectId(product.category._id),
          price: { $lt: product.price },
        },
      },
      
      // Lookup merchant
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true },
      },
      {
        $match: {
          'merchant.status': 'APPROVED',
        },
      },
      
      // Sort by price (ascending) then rating
      {
        $sort: {
          price: 1,
          averageRating: -1,
          visibilityScore: -1,
        },
      },
      
      { $limit: limit },
      
      // Populate category
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
      },
    ];
    
    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting cheaper alternatives', { error: error.message, productId });
    return [];
  }
}

/**
 * Get products from the same store
 */
async function getFromSameStore(productId, merchantId, baseFilter, limit = 20) {
  try {
    if (!merchantId) {
      return [];
    }
    
    const pipeline = [
      {
        $match: {
          ...baseFilter,
          _id: { $ne: new mongoose.Types.ObjectId(productId) },
          merchant: new mongoose.Types.ObjectId(merchantId),
        },
      },
      
      // Lookup merchant
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true },
      },
      {
        $match: {
          'merchant.status': 'APPROVED',
        },
      },
      
      // Sort by visibility score
      {
        $sort: {
          visibilityScore: -1,
          createdAt: -1,
        },
      },
      
      { $limit: limit },
      
      // Populate category
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
      },
    ];
    
    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting from same store', { error: error.message, productId, merchantId });
    return [];
  }
}

/**
 * Get cart recommendations (complementary products for items in cart)
 */
export async function getCartRecommendations(userId) {
  try {
    const user = await User.findOne({ clerkId: userId }).lean();
    if (!user) {
      return [];
    }
    
    const cart = await Cart.findOne({ user: user._id })
      .populate('products.product')
      .lean();
    
    if (!cart || !cart.products?.length) {
      // Return trending products if cart is empty
      return getTrendingProducts(getBaseFilter(), 20);
    }
    
    // Get categories from cart products
    const categoryIds = new Set();
    cart.products.forEach(item => {
      if (item.product?.category) {
        categoryIds.add(item.product.category.toString());
      }
    });
    
    const categories = Array.from(categoryIds);
    const cartProductIds = cart.products.map(item => item.product._id.toString());
    
    if (categories.length === 0) {
      return getTrendingProducts(getBaseFilter(), 20);
    }
    
    const baseFilter = getBaseFilter();
    
    const pipeline = [
      {
        $match: {
          ...baseFilter,
          _id: { $nin: cartProductIds.map(id => new mongoose.Types.ObjectId(id)) },
          category: { $in: categories.map(id => new mongoose.Types.ObjectId(id)) },
        },
      },
      
      // Lookup merchant
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true },
      },
      {
        $match: {
          'merchant.status': 'APPROVED',
        },
      },
      
      // Sort by visibility score
      {
        $sort: {
          visibilityScore: -1,
          createdAt: -1,
        },
      },
      
      { $limit: 20 },
      
      // Populate category
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category',
        },
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true },
      },
    ];
    
    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting cart recommendations', { error: error.message, userId });
    return [];
  }
}

/**
 * Get user-specific recommendations
 */
export async function getUserRecommendations(userId, limit = 20) {
  try {
    const baseFilter = getBaseFilter();
    return await getForYouRecommendations(userId, baseFilter, limit);
  } catch (error) {
    logger.error('Error getting user recommendations', { error: error.message, userId });
    return [];
  }
}
