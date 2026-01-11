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

/**
 * Get home screen data - all sections in one optimized endpoint
 * This reduces network calls and improves performance
 */
export const getHomeData = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const now = new Date();

    // Check merchant status - only show products from approved merchants
    const approvedMerchants = await Merchant.find({ status: 'APPROVED' }).select('_id').lean();
    const approvedMerchantIds = approvedMerchants.map(m => m._id);

    // Build base filter for available products
    const baseProductFilter = {
      isActive: true,
      deletedAt: null,
      // Check if product has stock (either main stock or variant stock)
      $or: [
        { stock: { $gt: 0 } },
        { 'variants.stock': { $gt: 0 } },
        { variants: { $size: 0 } } // Products without variants need main stock
      ],
      // Only show products from approved merchants or products without merchant
      $and: [
        {
          $or: [
            { merchant: { $in: approvedMerchantIds } },
            { merchant: null }
          ]
        }
      ]
    };

    // Parallel fetch all sections
    const [
      banners,
      categories,
      trendingProducts,
      flashDeals,
      newArrivals,
      stores
    ] = await Promise.all([
      // 1. Hero Banners
      Banner.find({ isActive: true })
        .sort({ order: 1, createdAt: -1 })
        .limit(10)
        .lean(),

      // 2. Categories (active only, with image)
      Category.find({ isActive: true, parent: null })
        .sort({ createdAt: -1 })
        .limit(12)
        .lean(),

      // 3. Trending Now - products ordered by orders, views, favorites
      getTrendingProducts(baseProductFilter),

      // 4. Flash Deals - products with discount > 0
      getFlashDeals(baseProductFilter),

      // 5. New Arrivals - latest products
      Product.find(baseProductFilter)
        .populate('merchant', 'businessName status')
        .populate('category', 'name')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),

      // 6. Store Highlights - approved merchants with high sales
      getStoreHighlights()
    ]);

    // 7. For You - personalized recommendations
    let forYouProducts = [];
    if (userId) {
      forYouProducts = await getForYouProducts(userId, baseProductFilter);
    } else {
      // If not logged in, use most popular products
      forYouProducts = trendingProducts.slice(0, 20);
    }

    // Calculate discount percentage for products
    const enrichProducts = (products) => {
      return products.map(product => {
        const price = product.price || 0;
        const discountPrice = product.discountPrice || 0;
        const discount = discountPrice > 0 && price > discountPrice
          ? Math.round(((price - discountPrice) / price) * 100)
          : 0;

        // Check if product has available stock
        const hasStock = product.stock > 0 || 
          (product.variants && product.variants.some(v => v.stock > 0 && v.isActive !== false));

        return {
          ...product,
          discount,
          hasStock,
          finalPrice: discountPrice > 0 && discountPrice < price ? discountPrice : price
        };
      });
    };

    const response = {
      banners: banners.map(b => ({
        _id: b._id,
        image: b.image,
        title: b.title,
        description: b.description,
        order: b.order
      })),
      categories: categories.map(c => ({
        _id: c._id,
        name: c.name,
        image: c.image,
        description: c.description
      })),
      trending: enrichProducts(trendingProducts),
      flashDeals: enrichProducts(flashDeals),
      newArrivals: enrichProducts(newArrivals),
      forYou: enrichProducts(forYouProducts),
      stores: stores
    };

    logger.info('Home data retrieved', {
      requestId: req.requestId,
      userId: userId || 'anonymous',
      bannersCount: banners.length,
      categoriesCount: categories.length,
      trendingCount: trendingProducts.length,
      flashDealsCount: flashDeals.length,
      newArrivalsCount: newArrivals.length,
      forYouCount: forYouProducts.length,
      storesCount: stores.length
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
    // Aggregate to calculate trending score
    const pipeline = [
      { $match: baseFilter },
      
      // Lookup orders to count product orders
      {
        $lookup: {
          from: 'orders',
          let: { productId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ['$$productId', '$products.product']
                },
                status: { $in: ['confirmed', 'shipped', 'delivered'] }
              }
            }
          ],
          as: 'orders'
        }
      },
      
      // Lookup wishlists to count favorites
      {
        $lookup: {
          from: 'wishlists',
          let: { productId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ['$$productId', '$products']
                }
              }
            }
          ],
          as: 'wishlists'
        }
      },
      
      // Calculate trending score
      {
        $addFields: {
          orderCount: { $size: '$orders' },
          favoriteCount: { $size: '$wishlists' },
          // Weight: orders (50%), favorites (30%), rating (20%)
          trendingScore: {
            $add: [
              { $multiply: [{ $size: '$orders' }, 5] },
              { $multiply: [{ $size: '$wishlists' }, 3] },
              { $multiply: [{ $ifNull: ['$averageRating', 0] }, 2] }
            ]
          }
        }
      },
      
      // Sort by trending score
      { $sort: { trendingScore: -1, createdAt: -1 } },
      { $limit: 20 },
      
      // Populate references
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant'
        }
      },
      {
        $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true }
      },
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category'
        }
      },
      {
        $unwind: { path: '$category', preserveNullAndEmptyArrays: true }
      },
      
      // Project only needed fields
      {
        $project: {
          orders: 0,
          wishlists: 0,
          trendingScore: 0
        }
      }
    ];

    const products = await Product.aggregate(pipeline);
    return products;
  } catch (error) {
    logger.error('Error getting trending products', { error: error.message });
    // Fallback to featured products
    return Product.find(baseFilter)
      .populate('merchant', 'businessName status')
      .populate('category', 'name')
      .sort({ featured: -1, priorityScore: -1, createdAt: -1 })
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
        .sort({ averageRating: -1, createdAt: -1 })
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
        averageRating: -1,
        createdAt: -1 
      })
      .limit(20)
      .lean();

    // If not enough products, fill with popular products
    if (recommendedProducts.length < 10) {
      const popularProducts = await Product.find(baseFilter)
        .populate('merchant', 'businessName status')
        .populate('category', 'name')
        .sort({ averageRating: -1, createdAt: -1 })
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
      .sort({ averageRating: -1, createdAt: -1 })
      .limit(20)
      .lean();
  }
}

/**
 * Get store highlights - approved merchants with high sales
 */
async function getStoreHighlights() {
  try {
    // Get merchants with their order counts
    const pipeline = [
      {
        $match: { status: 'APPROVED' }
      },
      {
        $lookup: {
          from: 'orders',
          let: { merchantId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ['$$merchantId', '$merchants']
                },
                status: { $in: ['confirmed', 'shipped', 'delivered'] }
              }
            }
          ],
          as: 'orders'
        }
      },
      {
        $addFields: {
          orderCount: { $size: '$orders' },
          totalRevenue: {
            $sum: {
              $map: {
                input: '$orders',
                as: 'order',
                in: '$$order.finalAmount'
              }
            }
          }
        }
      },
      {
        $sort: { orderCount: -1, totalRevenue: -1 }
      },
      {
        $limit: 10
      },
      {
        $project: {
          _id: 1,
          businessName: 1,
          businessDescription: 1,
          businessEmail: 1,
          status: 1,
          orderCount: 1,
          totalRevenue: 1,
          // Calculate rating (placeholder - you can add rating field to merchant schema)
          rating: { $ifNull: ['$rating', 4.5] } // Default rating
        }
      }
    ];

    const stores = await Merchant.aggregate(pipeline);
    
    return stores.map(store => ({
      _id: store._id,
      name: store.businessName,
      description: store.businessDescription,
      email: store.businessEmail,
      rating: store.rating,
      verified: store.status === 'APPROVED',
      orderCount: store.orderCount || 0,
      totalRevenue: store.totalRevenue || 0
    }));
  } catch (error) {
    logger.error('Error getting store highlights', { error: error.message });
    // Fallback to all approved merchants
    return Merchant.find({ status: 'APPROVED' })
      .select('businessName businessDescription businessEmail status')
      .limit(10)
      .lean()
      .then(stores => stores.map(store => ({
        _id: store._id,
        name: store.businessName,
        description: store.businessDescription,
        email: store.businessEmail,
        rating: 4.5, // Default rating
        verified: store.status === 'APPROVED',
        orderCount: 0,
        totalRevenue: 0
      })));
  }
}
