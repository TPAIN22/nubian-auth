import Product from '../models/product.model.js';
import Category from '../models/categories.model.js';
import Banner from '../models/banners.model.js';
import Merchant from '../models/merchant.model.js';
import Order from '../models/orders.model.js';
import Wishlist from '../models/wishlist.model.js';
import User from '../models/user.model.js';
import { sendSuccess, sendError } from '../lib/response.js';
import logger from '../lib/logger.js';
import { getAuth } from '@clerk/express';
import mongoose from 'mongoose';
import { convertProductPrices } from '../services/currency.service.js';
import { enrichProductsWithPricing } from './products.controller.js';
import { getCategories as getCategoriesInternal } from './category.controller.js';

let homeDataCache = null;
let homeCacheTimestamp = 0;
const HOME_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const invalidateHomeCache = () => {
    homeDataCache = null;
    homeCacheTimestamp = 0;
    logger.info('Home data cache invalidated');
};

/**
 * Get home screen data - all sections in one optimized endpoint
 * This reduces network calls and improves performance
 */
export const getHomeData = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const isAnonymous = !userId;

    // --- CACHE HIT PATH (FAST) ---
    if (isAnonymous && homeDataCache && (Date.now() - homeCacheTimestamp < HOME_CACHE_TTL)) {
      const resp = JSON.parse(JSON.stringify(homeDataCache));
      resp.forYou = resp.trending?.slice(0, 20) || [];
      return sendSuccess(res, { data: resp, message: 'Home data retrieved (cached)' });
    }

    // --- COLD START / AUTHENTICATED PATH ---
    const approvedMerchants = await Merchant.find({ status: 'APPROVED' }).select('_id').lean();
    const approvedMerchantIds = approvedMerchants.map(m => m._id);

    const baseProductFilter = {
      isActive: { $ne: false },
      deletedAt: null,
      'variants.stock': { $gt: 0 },
      $or: [
        { merchant: { $in: approvedMerchantIds } },
        { merchant: null },
      ],
    };

    // 7. For You - personalized recommendations
    let forYouProducts = [];

    // Try to use cached global data if available
    let response;
    
    if (isAnonymous && homeDataCache && (Date.now() - homeCacheTimestamp < HOME_CACHE_TTL)) {
      response = JSON.parse(JSON.stringify(homeDataCache));
    } else {
      // Parallel fetch all sections
      const [
        bannersData,
        categoriesData,
        trendingData,
        flashDealsData,
        newArrivalsData,
        storesData
      ] = await Promise.all([
        Banner.find({ isActive: true }).sort({ order: 1, createdAt: -1 }).limit(10).lean(),
        Category.find({ isActive: true }).sort({ createdAt: -1 }).limit(12).lean(),
        getTrendingProducts(baseProductFilter),
        getFlashDeals(baseProductFilter),
        Product.find(baseProductFilter).populate('merchant', 'businessName status').populate('category', 'name').sort({ createdAt: -1 }).limit(20).lean(),
        getStoreHighlights()
      ]);

      response = {
        banners: bannersData,
        categories: categoriesData,
        trending: enrichProductsWithPricing(trendingData),
        flashDeals: enrichProductsWithPricing(flashDealsData),
        newArrivals: enrichProductsWithPricing(newArrivalsData),
        stores: storesData
      };

      // Save to cache if anonymous
      if (isAnonymous) {
        homeDataCache = response;
        homeCacheTimestamp = Date.now();
      }
    }

    // Personalized For You section
    if (userId) {
      forYouProducts = await getForYouProducts(userId, baseProductFilter);
      response.forYou = enrichProductsWithPricing(forYouProducts);
    } else {
      // If not logged in, use most popular products from trending
      response.forYou = response.trending.slice(0, 20);
    }

    // Apply currency conversion if currencyCode is provided
    // Middleware already extracts it from headers or query
    const currencyCode = req.currencyCode;
    
    if (currencyCode && currencyCode.toUpperCase() !== 'USD') {
      try {
        // PERF: Fetch rate and config ONCE for all sections
        const upperCode = currencyCode.toUpperCase();
        
        // Import necessary models/services
        const CurrencyModel = (await import('../models/currency.model.js')).default;
        const { getLatestRate } = await import('../services/fx.service.js');

        const [currencyConfig, rateInfo] = await Promise.all([
             CurrencyModel.findOne({ code: upperCode }).lean(),
             getLatestRate(upperCode)
        ]);
        
        const currencyContext = {
            config: currencyConfig,
            rate: rateInfo
        };

        const productLists = ['trending', 'flashDeals', 'newArrivals', 'forYou'];
        await Promise.all(
          productLists.map(async (key) => {
            if (Array.isArray(response[key])) {
              response[key] = await Promise.all(
                response[key].map(product => convertProductPrices(product, currencyCode, currencyContext))
              );
            }
          })
        );
        logger.debug('Applied currency conversion to home data', { currencyCode });
      } catch (conversionError) {
        logger.warn('Currency conversion failed for home data', {
          currencyCode,
          error: conversionError.message,
        });
      }
    }

    logger.info('Home data retrieved', {
      requestId: req.requestId,
      userId: userId || 'anonymous',
      bannersCount: response.banners?.length || 0,
      categoriesCount: response.categories?.length || 0,
      trendingCount: response.trending?.length || 0,
      flashDealsCount: response.flashDeals?.length || 0,
      newArrivalsCount: response.newArrivals?.length || 0,
      forYouCount: response.forYou?.length || 0,
      storesCount: response.stores?.length || 0
    });

    return sendSuccess(res, {
      data: response,
      message: 'Home data retrieved successfully'
    });
  } catch (error) {
    logger.error('Error retrieving home data', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    throw error;
  }
};

/**
 * Get trending products based on orders, views, and favorites
 */
async function getTrendingProducts(baseFilter) {
  try {
    // Simplify trending calculation to avoid expensive lookups
    // Weight: averageRating (50%), priorityScore (30%), featured (20%)
    return Product.find(baseFilter)
      .populate('merchant', 'businessName status')
      .populate('category', 'name')
      .sort({ 
        featured: -1, 
        priorityScore: -1,
        createdAt: -1
      })
      .limit(20)
      .lean();
  } catch (error) {
    logger.error('Error getting trending products', { error: error.message });
    // Fallback
    return Product.find(baseFilter)
      .populate('merchant', 'businessName status')
      .populate('category', 'name')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
  }
}

/**
 * Get flash deals - products with active discounts
 */
async function getFlashDeals(baseFilter) {
  const filter = {
    ...baseFilter,
    $or: [
      { discountPrice: { $gt: 0 } },
      { 'variants.discountPrice': { $gt: 0 } }
    ]
  };

  return Product.find(filter)
    .populate('merchant', 'businessName status')
    .populate('category', 'name')
    .sort({ 
      // Sort by discount percentage (highest first)
      discountPrice: -1,
      createdAt: -1 
    })
    .limit(20)
    .lean();
}

/**
 * Get personalized "For You" products based on user history
 */
async function getForYouProducts(clerkId, baseFilter) {
  try {
    // Find user by clerkId
    const user = await User.findOne({ clerkId }).select('_id').lean();
    if (!user) {
      // User not found in database, return popular products
      return Product.find(baseFilter)
        .populate('merchant', 'businessName status')
        .populate('category', 'name')
        .sort({ featured: -1, priorityScore: -1, createdAt: -1 })
        .limit(20)
        .lean();
    }

    // Get user's past orders
    const userOrders = await Order.find({ user: user._id })
      .select('products.product')
      .limit(50)
      .lean();

    // Extract product IDs from orders
    const orderedProductIds = [];
    userOrders.forEach(order => {
      order.products.forEach(item => {
        if (item.product && !orderedProductIds.includes(item.product.toString())) {
          orderedProductIds.push(item.product);
        }
      });
    });

    // Get user's wishlist
    const wishlist = await Wishlist.findOne({ user: user._id }).lean();
    const wishlistProductIds = wishlist?.products?.map(p => p.toString()) || [];

    // Get categories from ordered products
    const orderedProducts = await Product.find({
      _id: { $in: orderedProductIds },
      ...baseFilter
    })
    .select('category')
    .limit(20)
    .lean();

    const preferredCategoryIds = [...new Set(
      orderedProducts.map(p => p.category?.toString()).filter(Boolean)
    )];

    // Build recommendation query
    let recommendationFilter = { ...baseFilter };

    // Prioritize products from preferred categories
    if (preferredCategoryIds.length > 0) {
      recommendationFilter.category = { $in: preferredCategoryIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    // Exclude already ordered products
    if (orderedProductIds.length > 0) {
      recommendationFilter._id = { $nin: orderedProductIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    // Get recommended products
    let recommendedProducts = await Product.find(recommendationFilter)
      .populate('merchant', 'businessName status')
      .populate('category', 'name')
      .sort({ 
        featured: -1,
        priorityScore: -1,
        createdAt: -1 
      })
      .limit(20)
      .lean();

    // If not enough products, fill with popular products
    if (recommendedProducts.length < 10) {
      const popularProducts = await Product.find(baseFilter)
        .populate('merchant', 'businessName status')
        .populate('category', 'name')
        .sort({ featured: -1, priorityScore: -1, createdAt: -1 })
        .limit(20 - recommendedProducts.length)
        .lean();
      
      recommendedProducts = [...recommendedProducts, ...popularProducts];
    }

    return recommendedProducts.slice(0, 20);
  } catch (error) {
    logger.error('Error getting for you products', { error: error.message });
    // Fallback to popular products
    return Product.find(baseFilter)
      .populate('merchant', 'businessName status')
      .populate('category', 'name')
      .sort({ featured: -1, priorityScore: -1, createdAt: -1 })
      .limit(20)
      .lean();
  }
}

/**
 * Get store highlights - approved merchants with high sales
 */
async function getStoreHighlights() {
  try {
    // Simplify store highlights to avoid expensive lookup on every request
    const stores = await Merchant.find({ status: 'APPROVED' })
      .select('businessName businessDescription businessEmail status rating priorityScore')
      .sort({ priorityScore: -1, rating: -1 })
      .limit(10)
      .lean();
    
    return stores.map(store => ({
      _id: store._id,
      name: store.businessName,
      description: store.businessDescription,
      email: store.businessEmail,
      rating: store.rating || 4.5,
      verified: store.status === 'APPROVED',
      orderCount: 0, // Placeholder
      totalRevenue: 0 // Placeholder
    }));
  } catch (error) {
    logger.error('Error getting store highlights', { error: error.message });
    // Fallback
    const stores = await Merchant.find({ status: 'APPROVED' })
      .select('businessName businessDescription businessEmail status')
      .limit(10)
      .lean();
      
    return stores.map(store => ({
      _id: store._id,
      name: store.businessName,
      description: store.businessDescription,
      email: store.businessEmail,
      rating: 4.5,
      verified: true
    }));
  }
}
