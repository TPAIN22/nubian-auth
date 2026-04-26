// services/productScoring.service.js
import mongoose from 'mongoose';
import Product from '../models/product.model.js';
import UserActivity from '../models/userActivity.model.js';
import logger from '../lib/logger.js';

// ─── Score weights ──────────────────────────────────────────────────────────
const W = {
  view: 1,
  cartAdd: 3,
  wishlist: 2,
  purchase: 5,
  conversionMultiplier: 10,
  ratingMultiplier: 4,
  maxDiscount: 20,      // discount boost cap (points)
  maxFreshness: 15,     // freshness boost cap (points), decays over 30 days
  featuredBoost: 100,
};

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Compute all scores for one product given its pre-aggregated activity stats.
 * All math lives here — no other service should duplicate this.
 */
function computeScores(product, stats = {}) {
  const {
    views7d = 0,
    cartAdds7d = 0,
    purchases7d = 0,
    wishlists7d = 0,
  } = stats;

  const engagementScore = views7d * W.view + cartAdds7d * W.cartAdd;
  const popularityScore = wishlists7d * W.wishlist + purchases7d * W.purchase;
  const trendingScore   = engagementScore + popularityScore;

  const conversionRate  = views7d > 0
    ? Math.min(100, (purchases7d / views7d) * 100)
    : 0;

  const daysSinceCreation = Math.floor(
    (Date.now() - new Date(product.createdAt).getTime()) / 86_400_000
  );
  const freshnessScore = daysSinceCreation <= 30
    ? Math.max(0, W.maxFreshness * (1 - daysSinceCreation / 30))
    : 0;

  // Discount boost: use the largest merchantDiscount across active variants
  const maxDiscount = (product.variants || []).reduce((max, v) => {
    if (v.isActive === false) return max;
    const pct = v.merchantPrice > 0
      ? ((v.merchantDiscount || 0) / v.merchantPrice) * 100
      : 0;
    return Math.max(max, pct);
  }, 0);
  const discountBoost = Math.min(W.maxDiscount, maxDiscount * 2);

  const featuredBoost  = product.featured ? W.featuredBoost : 0;
  const rating         = product.averageRating || 0;

  const visibilityScore = Math.round(
    trendingScore +
    freshnessScore +
    conversionRate * W.conversionMultiplier +
    rating * W.ratingMultiplier +
    discountBoost +
    featuredBoost
  );

  return {
    trendingScore:    Math.round(trendingScore),
    engagementScore:  Math.round(engagementScore),
    popularityScore:  Math.round(popularityScore),
    freshnessScore:   Math.round(freshnessScore),
    conversionRate:   Math.round(conversionRate * 100) / 100,
    visibilityScore,
  };
}

/**
 * Aggregate UserActivity for a given time window.
 * Returns a Map<productId(string), stats>.
 */
async function aggregateActivity(since7d, since24h) {
  const rows = await UserActivity.aggregate([
    { $match: { productId: { $ne: null }, timestamp: { $gte: since7d } } },
    {
      $group: {
        _id: '$productId',
        views7d: {
          $sum: { $cond: [{ $in: ['$event', ['product_view', 'product_click']] }, 1, 0] },
        },
        cartAdds7d: {
          $sum: { $cond: [{ $eq: ['$event', 'add_to_cart'] }, 1, 0] },
        },
        purchases7d: {
          $sum: { $cond: [{ $eq: ['$event', 'purchase'] }, 1, 0] },
        },
        wishlists7d: {
          $sum: { $cond: [{ $eq: ['$event', 'wishlist_add'] }, 1, 0] },
        },
        views24h: {
          $sum: {
            $cond: [
              { $and: [
                { $in: ['$event', ['product_view', 'product_click']] },
                { $gte: ['$timestamp', since24h] },
              ]},
              1, 0,
            ],
          },
        },
        cartAdds24h: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: ['$event', 'add_to_cart'] },
                { $gte: ['$timestamp', since24h] },
              ]},
              1, 0,
            ],
          },
        },
        sales24h: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: ['$event', 'purchase'] },
                { $gte: ['$timestamp', since24h] },
              ]},
              1, 0,
            ],
          },
        },
        favoritesCount: {
          $sum: { $cond: [{ $eq: ['$event', 'wishlist_add'] }, 1, 0] },
        },
      },
    },
  ]);

  return new Map(rows.map(r => [r._id.toString(), r]));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Batch-recalculate scores for ALL active products.
 * Cron-ready: called hourly from cron.service.
 *
 * Algorithm:
 *   1. ONE UserActivity aggregate  → activity stats per product
 *   2. ONE Product.find            → product data needed for scoring
 *   3. In-memory score computation
 *   4. ONE Product.bulkWrite       → persist all scores
 */
export async function calculateProductScores() {
  const startTime = Date.now();
  logger.info('productScoring: batch recalculation started');

  const since7d  = new Date(Date.now() - 7  * 86_400_000);
  const since24h = new Date(Date.now() - 1  * 86_400_000);

  // 1. Activity stats for all products in one aggregation
  const activityMap = await aggregateActivity(since7d, since24h);

  // 2. Fetch active products (only fields needed for scoring)
  const products = await Product.find(
    { isActive: true, deletedAt: null },
    {
      averageRating: 1,
      featured: 1,
      createdAt: 1,
      variants: { $elemMatch: { isActive: { $ne: false } } },
      'variants.isActive': 1,
      'variants.merchantPrice': 1,
      'variants.merchantDiscount': 1,
    }
  ).lean();

  logger.info(`productScoring: scoring ${products.length} products`);

  // 3. Build bulkWrite operations
  const ops = products.map((product) => {
    const stats  = activityMap.get(product._id.toString()) || {};
    const scores = computeScores(product, stats);

    return {
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: {
            'ranking.visibilityScore': scores.visibilityScore,
            'ranking.trendingScore':   scores.trendingScore,
            'ranking.conversionRate':  scores.conversionRate,
            'trackingFields.views24h':      stats.views24h      || 0,
            'trackingFields.cartCount24h':  stats.cartAdds24h   || 0,
            'trackingFields.sales24h':      stats.sales24h      || 0,
            'trackingFields.favoritesCount': stats.favoritesCount || 0,
            'trackingFields.scoreCalculatedAt': new Date(),
          },
        },
      },
    };
  });

  // 4. Persist in one bulk operation (unordered for max throughput)
  let updated = 0;
  let errors  = 0;

  if (ops.length > 0) {
    try {
      const result = await Product.bulkWrite(ops, { ordered: false });
      updated = result.modifiedCount ?? ops.length;
    } catch (err) {
      // bulkWrite with ordered:false reports per-op errors in err.writeErrors
      errors  = err.writeErrors?.length ?? ops.length;
      updated = ops.length - errors;
      logger.error('productScoring: bulkWrite partial failure', {
        errors,
        message: err.message,
      });
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info('productScoring: batch recalculation completed', {
    total: products.length,
    updated,
    errors,
    durationMs,
  });

  return { total: products.length, updated, errors, durationMs };
}

/**
 * Recalculate scores for a single product on demand.
 * Use for admin triggers or after manual product edits.
 */
export async function calculateSingleProductScore(productId) {
  const since7d  = new Date(Date.now() - 7 * 86_400_000);
  const since24h = new Date(Date.now() - 1 * 86_400_000);

  const [product, activityRows] = await Promise.all([
    Product.findById(productId, {
      averageRating: 1,
      featured: 1,
      createdAt: 1,
      isActive: 1,
      deletedAt: 1,
      variants: 1,
    }).lean(),

    UserActivity.aggregate([
      {
        $match: {
          productId: new mongoose.Types.ObjectId(productId),
          timestamp: { $gte: since7d },
        },
      },
      {
        $group: {
          _id: null,
          views7d:    { $sum: { $cond: [{ $in: ['$event', ['product_view', 'product_click']] }, 1, 0] } },
          cartAdds7d: { $sum: { $cond: [{ $eq: ['$event', 'add_to_cart'] }, 1, 0] } },
          purchases7d:{ $sum: { $cond: [{ $eq: ['$event', 'purchase'] }, 1, 0] } },
          wishlists7d:{ $sum: { $cond: [{ $eq: ['$event', 'wishlist_add'] }, 1, 0] } },
          views24h:   {
            $sum: { $cond: [
              { $and: [{ $in: ['$event', ['product_view', 'product_click']] }, { $gte: ['$timestamp', since24h] }] },
              1, 0,
            ]},
          },
          cartAdds24h: {
            $sum: { $cond: [
              { $and: [{ $eq: ['$event', 'add_to_cart'] }, { $gte: ['$timestamp', since24h] }] },
              1, 0,
            ]},
          },
          sales24h: {
            $sum: { $cond: [
              { $and: [{ $eq: ['$event', 'purchase'] }, { $gte: ['$timestamp', since24h] }] },
              1, 0,
            ]},
          },
          favoritesCount: { $sum: { $cond: [{ $eq: ['$event', 'wishlist_add'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  if (!product || !product.isActive || product.deletedAt) return null;

  const stats  = activityRows[0] || {};
  const scores = computeScores(product, stats);

  await Product.findByIdAndUpdate(productId, {
    $set: {
      'ranking.visibilityScore': scores.visibilityScore,
      'ranking.trendingScore':   scores.trendingScore,
      'ranking.conversionRate':  scores.conversionRate,
      'trackingFields.views24h':       stats.views24h      || 0,
      'trackingFields.cartCount24h':   stats.cartAdds24h   || 0,
      'trackingFields.sales24h':       stats.sales24h      || 0,
      'trackingFields.favoritesCount': stats.favoritesCount || 0,
      'trackingFields.scoreCalculatedAt': new Date(),
    },
  });

  return { productId, ...scores };
}

// Kept for backward compat with any callers — now a lightweight atomic $inc
// instead of a full recalculation on every event (which would thrash the DB).
// The cron handles full recalculation every hour.

export async function updateProductScoreOnOrder(productId) {
  try {
    await Product.findByIdAndUpdate(productId, {
      $inc: {
        'trackingFields.sales24h':    1,
        'trackingFields.cartCount24h': 1,
      },
    });
  } catch (err) {
    logger.error('productScoring: updateProductScoreOnOrder failed', { productId, error: err.message });
  }
}

export async function updateProductScoreOnView(productId) {
  try {
    await Product.findByIdAndUpdate(productId, {
      $inc: { 'trackingFields.views24h': 1 },
    });
  } catch (err) {
    logger.error('productScoring: updateProductScoreOnView failed', { productId, error: err.message });
  }
}

export async function updateProductScoreOnFavorite(productId) {
  try {
    await Product.findByIdAndUpdate(productId, {
      $inc: { 'trackingFields.favoritesCount': 1 },
    });
  } catch (err) {
    logger.error('productScoring: updateProductScoreOnFavorite failed', { productId, error: err.message });
  }
}
