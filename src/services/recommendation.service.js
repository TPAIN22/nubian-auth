// services/recommendation.service.js
import mongoose from 'mongoose';
import Product from '../models/product.model.js';
import User from '../models/user.model.js';
import UserActivity from '../models/userActivity.model.js';
import Order from '../models/orders.model.js';
import Cart from '../models/carts.model.js';
import Merchant from '../models/merchant.model.js';
import logger from '../lib/logger.js';

// ─── Merchant approval cache (5-min TTL) ─────────────────────────────────────
// Avoids a $lookup join on every recommendation query.

const merchantCache = { ids: [], fetchedAt: 0 };
const MERCHANT_CACHE_TTL = 5 * 60 * 1000;

async function getApprovedMerchantIds() {
  if (Date.now() - merchantCache.fetchedAt < MERCHANT_CACHE_TTL) {
    return merchantCache.ids;
  }
  const merchants = await Merchant.find({ status: 'approved' }, '_id').lean();
  merchantCache.ids       = merchants.map(m => m._id);
  merchantCache.fetchedAt = Date.now();
  return merchantCache.ids;
}

/** Adds merchant-approval filter without a $lookup join. */
async function withMerchantFilter(baseFilter) {
  const approvedIds = await getApprovedMerchantIds();
  return {
    ...baseFilter,
    $or: [
      { merchant: null },
      { merchant: { $in: approvedIds } },
    ],
  };
}

// ─── Base filter ─────────────────────────────────────────────────────────────

function getBaseFilter() {
  return { isActive: true, deletedAt: null };
}

// ─── Section builders (read-only, no scoring logic) ──────────────────────────

/**
 * Trending: sorted by precomputed ranking.trendingScore.
 * No scoring at query time — just a sort on a persisted field.
 */
async function getTrendingProducts(baseFilter, limit = 20) {
  const filter = await withMerchantFilter(baseFilter);
  return Product.find(filter)
    .sort({ 'ranking.trendingScore': -1, 'ranking.visibilityScore': -1 })
    .limit(limit)
    .populate('category', 'name slug')
    .lean();
}

/**
 * Flash deals: products with an active discount, sorted by visibility score.
 * discountBoost is already baked into ranking.visibilityScore by productScoring cron,
 * so the highest-discount products naturally float to the top.
 */
async function getFlashDeals(baseFilter, limit = 20) {
  const filter = await withMerchantFilter({
    ...baseFilter,
    $or: [
      { 'variants.merchantDiscount': { $gt: 0 } },
      { discountPrice: { $gt: 0 } },  // legacy field — kept for backward compat
    ],
  });
  return Product.find(filter)
    .sort({ 'ranking.visibilityScore': -1, createdAt: -1 })
    .limit(limit)
    .populate('category', 'name slug')
    .lean();
}

/**
 * New arrivals: products added in the last 30 days, newest first.
 */
async function getNewArrivals(baseFilter, limit = 20) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
  const filter = await withMerchantFilter({
    ...baseFilter,
    createdAt: { $gte: thirtyDaysAgo },
  });
  return Product.find(filter)
    .sort({ createdAt: -1, 'ranking.visibilityScore': -1 })
    .limit(limit)
    .populate('category', 'name slug')
    .lean();
}

/**
 * For You: category-affinity filter built from UserActivity, sorted by
 * precomputed ranking.visibilityScore. No inline scoring.
 */
async function getForYouRecommendations(userId, baseFilter, limit = 20) {
  try {
    const [viewEvents, purchaseEvents] = await Promise.all([
      UserActivity.find({
        userId,
        event: { $in: ['product_view', 'product_click'] },
        productId: { $ne: null },
      })
        .sort({ timestamp: -1 })
        .limit(50)
        .select('productId categoryId')
        .lean(),
      UserActivity.find({
        userId,
        event: 'purchase',
        categoryId: { $ne: null },
      })
        .sort({ timestamp: -1 })
        .limit(20)
        .select('categoryId')
        .lean(),
    ]);

    if (!viewEvents.length && !purchaseEvents.length) {
      return getTrendingProducts(baseFilter, limit);
    }

    // Collect preferred categories
    const categoryIds = new Set();
    const productIdsNeedingCategory = [];

    viewEvents.forEach(ev => {
      if (ev.categoryId) {
        categoryIds.add(ev.categoryId.toString());
      } else if (ev.productId) {
        productIdsNeedingCategory.push(ev.productId);
      }
    });
    purchaseEvents.forEach(ev => {
      if (ev.categoryId) categoryIds.add(ev.categoryId.toString());
    });

    if (productIdsNeedingCategory.length > 0) {
      const docs = await Product.find(
        { _id: { $in: productIdsNeedingCategory } },
        { category: 1 }
      ).lean();
      docs.forEach(p => {
        if (p.category) categoryIds.add(p.category.toString());
      });
    }

    const preferredCategories = Array.from(categoryIds).map(
      id => new mongoose.Types.ObjectId(id)
    );

    if (!preferredCategories.length) {
      return getTrendingProducts(baseFilter, limit);
    }

    const viewedProductIds = viewEvents
      .filter(ev => ev.productId)
      .map(ev => new mongoose.Types.ObjectId(ev.productId.toString()));

    const filter = await withMerchantFilter({
      ...baseFilter,
      _id: { $nin: viewedProductIds },
      category: { $in: preferredCategories },
    });

    return Product.find(filter)
      .sort({ 'ranking.visibilityScore': -1 })
      .limit(limit)
      .populate('category', 'name slug')
      .lean();
  } catch (error) {
    logger.error('recommendation: getForYouRecommendations failed', {
      error: error.message, userId,
    });
    return getTrendingProducts(baseFilter, limit);
  }
}

/**
 * Brands You Love: uses user's preferred brands from profile.
 * Falls back to trending when no brand preference exists.
 */
async function getBrandsYouLove(userId, baseFilter, limit = 20) {
  try {
    const user = await User.findOne({ clerkId: userId }).lean();
    if (!user?.preferredBrands?.length) {
      return getTrendingProducts(baseFilter, limit);
    }
    // TODO: match by merchant businessName once merchant brand field is indexed
    return getTrendingProducts(baseFilter, limit);
  } catch (error) {
    logger.error('recommendation: getBrandsYouLove failed', { error: error.message, userId });
    return getTrendingProducts(baseFilter, limit);
  }
}

// ─── Product page section builders ───────────────────────────────────────────

/**
 * Similar items: same category, similar price range, sorted by visibilityScore.
 */
async function getSimilarItems(productId, product, baseFilter, limit = 20) {
  try {
    const categoryId = product.category?._id ?? product.category;
    if (!categoryId) return [];

    const priceRange = 0.5;
    const basePrice  = product.finalPrice || product.price || 0;
    const filter     = await withMerchantFilter({
      ...baseFilter,
      _id: { $ne: new mongoose.Types.ObjectId(productId) },
      category: new mongoose.Types.ObjectId(categoryId.toString()),
      ...(basePrice > 0 ? {
        finalPrice: {
          $gte: basePrice * (1 - priceRange),
          $lte: basePrice * (1 + priceRange),
        },
      } : {}),
    });

    return Product.find(filter)
      .sort({ 'ranking.visibilityScore': -1 })
      .limit(limit)
      .populate('category', 'name slug')
      .lean();
  } catch (error) {
    logger.error('recommendation: getSimilarItems failed', { error: error.message, productId });
    return [];
  }
}

/**
 * Frequently bought together: based on co-occurrence in confirmed orders.
 * Falls back to similar items when no order data exists.
 */
async function getFrequentlyBoughtTogether(productId, product, baseFilter, limit = 20) {
  try {
    const orders = await Order.find({
      'products.product': new mongoose.Types.ObjectId(productId),
      status: { $in: ['confirmed', 'shipped', 'delivered'] },
    })
      .select('products.product')
      .lean();

    const counts = new Map();
    orders.forEach(order => {
      order.products.forEach(item => {
        const id = item.product?.toString();
        if (id && id !== productId) counts.set(id, (counts.get(id) || 0) + 1);
      });
    });

    if (!counts.size) {
      return getSimilarItems(productId, product, baseFilter, limit);
    }

    const topIds = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => new mongoose.Types.ObjectId(id));

    const filter = await withMerchantFilter({
      ...baseFilter,
      _id: { $in: topIds },
    });

    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .lean();

    // Preserve co-purchase frequency order
    const byId = new Map(products.map(p => [p._id.toString(), p]));
    return topIds.map(id => byId.get(id.toString())).filter(Boolean);
  } catch (error) {
    logger.error('recommendation: getFrequentlyBoughtTogether failed', { error: error.message, productId });
    return getSimilarItems(productId, product, baseFilter, limit);
  }
}

/**
 * You may also like: category affinity from user's view history.
 */
async function getYouMayAlsoLike(userId, productId, product, baseFilter, limit = 20) {
  try {
    const viewEvents = await UserActivity.find({
      userId,
      event: { $in: ['product_view', 'product_click'] },
      productId: { $ne: null },
    })
      .sort({ timestamp: -1 })
      .limit(50)
      .select('productId categoryId')
      .lean();

    if (!viewEvents.length) {
      return getSimilarItems(productId, product, baseFilter, limit);
    }

    const categoryIds = new Set();
    const productIdsNeedingCategory = [];

    viewEvents.forEach(ev => {
      if (ev.categoryId) {
        categoryIds.add(ev.categoryId.toString());
      } else if (ev.productId) {
        productIdsNeedingCategory.push(ev.productId);
      }
    });

    if (productIdsNeedingCategory.length > 0) {
      const docs = await Product.find(
        { _id: { $in: productIdsNeedingCategory } },
        { category: 1 }
      ).lean();
      docs.forEach(p => { if (p.category) categoryIds.add(p.category.toString()); });
    }

    const preferredCategories = Array.from(categoryIds).map(
      id => new mongoose.Types.ObjectId(id)
    );

    if (!preferredCategories.length) {
      return getSimilarItems(productId, product, baseFilter, limit);
    }

    const filter = await withMerchantFilter({
      ...baseFilter,
      _id: { $ne: new mongoose.Types.ObjectId(productId) },
      category: { $in: preferredCategories },
    });

    return Product.find(filter)
      .sort({ 'ranking.visibilityScore': -1 })
      .limit(limit)
      .populate('category', 'name slug')
      .lean();
  } catch (error) {
    logger.error('recommendation: getYouMayAlsoLike failed', { error: error.message, userId, productId });
    return getSimilarItems(productId, product, baseFilter, limit);
  }
}

/**
 * Cheaper alternatives: same category, lower finalPrice, sorted by price asc then rating.
 */
async function getCheaperAlternatives(productId, product, baseFilter, limit = 20) {
  try {
    const categoryId = product.category?._id ?? product.category;
    const basePrice  = product.finalPrice || product.price || 0;
    if (!categoryId || !basePrice) return [];

    const filter = await withMerchantFilter({
      ...baseFilter,
      _id: { $ne: new mongoose.Types.ObjectId(productId) },
      category: new mongoose.Types.ObjectId(categoryId.toString()),
      finalPrice: { $gt: 0, $lt: basePrice },
    });

    return Product.find(filter)
      .sort({ finalPrice: 1, averageRating: -1, 'ranking.visibilityScore': -1 })
      .limit(limit)
      .populate('category', 'name slug')
      .lean();
  } catch (error) {
    logger.error('recommendation: getCheaperAlternatives failed', { error: error.message, productId });
    return [];
  }
}

/**
 * From the same store: products by the same approved merchant.
 */
async function getFromSameStore(productId, merchantId, baseFilter, limit = 20) {
  try {
    if (!merchantId) return [];

    const approvedIds = await getApprovedMerchantIds();
    const isApproved  = approvedIds.some(id => id.toString() === merchantId.toString());
    if (!isApproved) return [];

    return Product.find({
      ...baseFilter,
      _id: { $ne: new mongoose.Types.ObjectId(productId) },
      merchant: new mongoose.Types.ObjectId(merchantId.toString()),
    })
      .sort({ 'ranking.visibilityScore': -1, createdAt: -1 })
      .limit(limit)
      .populate('category', 'name slug')
      .lean();
  } catch (error) {
    logger.error('recommendation: getFromSameStore failed', { error: error.message, productId, merchantId });
    return [];
  }
}

// ─── Public exports ───────────────────────────────────────────────────────────

/**
 * Home page recommendations.
 * All sections use precomputed score fields — no runtime scoring.
 */
export async function getHomeRecommendations(userId) {
  try {
    const user       = userId ? await User.findOne({ clerkId: userId }).lean() : null;
    const baseFilter = getBaseFilter();

    const [forYou, trending, flashDeals, newArrivals, brandsYouLove] = await Promise.all([
      user
        ? getForYouRecommendations(userId, baseFilter, 20)
        : getTrendingProducts(baseFilter, 20),
      getTrendingProducts(baseFilter, 20),
      getFlashDeals(baseFilter, 20),
      getNewArrivals(baseFilter, 20),
      user
        ? getBrandsYouLove(userId, baseFilter, 20)
        : getTrendingProducts(baseFilter, 20),
    ]);

    return {
      forYou:       forYou.slice(0, 20),
      trending:     trending.slice(0, 20),
      flashDeals:   flashDeals.slice(0, 20),
      newArrivals:  newArrivals.slice(0, 20),
      brandsYouLove: brandsYouLove.slice(0, 20),
    };
  } catch (error) {
    logger.error('recommendation: getHomeRecommendations failed', {
      error: error.message, userId,
    });
    throw error;
  }
}

/**
 * Product page recommendations.
 * Returns five sections: similar, bought-together, may-also-like, cheaper, same-store.
 */
export async function getProductRecommendations(productId, userId = null) {
  try {
    const product = await Product.findById(productId)
      .populate('category', 'name slug')
      .lean();

    if (!product) throw new Error('Product not found');

    const baseFilter   = getBaseFilter();
    const merchantId   = product.merchant?._id ?? product.merchant;

    const [
      similarItems,
      frequentlyBoughtTogether,
      youMayAlsoLike,
      cheaperAlternatives,
      fromSameStore,
    ] = await Promise.all([
      getSimilarItems(productId, product, baseFilter, 20),
      getFrequentlyBoughtTogether(productId, product, baseFilter, 20),
      userId
        ? getYouMayAlsoLike(userId, productId, product, baseFilter, 20)
        : getSimilarItems(productId, product, baseFilter, 20),
      getCheaperAlternatives(productId, product, baseFilter, 20),
      getFromSameStore(productId, merchantId, baseFilter, 20),
    ]);

    return {
      similarItems:             similarItems.slice(0, 20),
      frequentlyBoughtTogether: frequentlyBoughtTogether.slice(0, 20),
      youMayAlsoLike:           youMayAlsoLike.slice(0, 20),
      cheaperAlternatives:      cheaperAlternatives.slice(0, 20),
      fromSameStore:            fromSameStore.slice(0, 20),
    };
  } catch (error) {
    logger.error('recommendation: getProductRecommendations failed', {
      error: error.message, productId, userId,
    });
    throw error;
  }
}

/**
 * Cart recommendations: products in the same categories as cart items.
 */
export async function getCartRecommendations(userId) {
  try {
    const user = await User.findOne({ clerkId: userId }).lean();
    if (!user) return [];

    const cart = await Cart.findOne({ user: user._id })
      .populate('products.product', 'category')
      .lean();

    if (!cart?.products?.length) {
      return getTrendingProducts(getBaseFilter(), 20);
    }

    const categoryIds = new Set();
    const cartProductIds = [];

    cart.products.forEach(item => {
      if (item.product?._id) cartProductIds.push(item.product._id.toString());
      if (item.product?.category) categoryIds.add(item.product.category.toString());
    });

    if (!categoryIds.size) {
      return getTrendingProducts(getBaseFilter(), 20);
    }

    const filter = await withMerchantFilter({
      ...getBaseFilter(),
      _id: { $nin: cartProductIds.map(id => new mongoose.Types.ObjectId(id)) },
      category: { $in: Array.from(categoryIds).map(id => new mongoose.Types.ObjectId(id)) },
    });

    return Product.find(filter)
      .sort({ 'ranking.visibilityScore': -1, createdAt: -1 })
      .limit(20)
      .populate('category', 'name slug')
      .lean();
  } catch (error) {
    logger.error('recommendation: getCartRecommendations failed', { error: error.message, userId });
    return [];
  }
}

/**
 * User-specific "For You" recommendations.
 */
export async function getUserRecommendations(userId, limit = 20) {
  try {
    return await getForYouRecommendations(userId, getBaseFilter(), limit);
  } catch (error) {
    logger.error('recommendation: getUserRecommendations failed', { error: error.message, userId });
    return [];
  }
}
