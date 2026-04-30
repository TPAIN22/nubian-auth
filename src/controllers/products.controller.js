import mongoose from 'mongoose'
import Product from '../models/product.model.js'
import Merchant from '../models/merchant.model.js'
import User from '../models/user.model.js'
import UserActivity from '../models/userActivity.model.js'
import Category from '../models/categories.model.js'
import { getAuth } from '@clerk/express'
import { clerkClient } from '@clerk/express'
import { sendSuccess, sendError, sendCreated, sendNotFound, sendPaginated, sendForbidden } from '../lib/response.js'
import logger from '../lib/logger.js'
import { getUserPreferredCategories, RANKING_CONSTANTS } from '../utils/productRanking.js'
import { convertProductPrices } from '../services/currency.service.js'
import {
  calculateFinalPrice,
  calculateProductPricing,
  isProductDiscountActive,
} from '../lib/pricing.engine.js'

/**
 * Enrich product with pricing breakdown for API responses.
 *
 * Routes everything through the pricing engine (lib/pricing.engine.js) so the
 * formula is identical to the model pre-save hook and the dynamic-pricing cron.
 *
 * Output shape (per product):
 *   {
 *     ...productFields,
 *     // root "From" price — lowest active variant
 *     merchantPrice, price, finalPrice, originalPrice, discountAmount,
 *     discountPercentage, hasDiscount,
 *     // legacy aliases (kept for back-compat with existing dashboards)
 *     displayOriginalPrice, displayFinalPrice, displayDiscountPercentage,
 *     pricing: { listPrice, originalPrice, finalPrice, discount: { amount, percentage, source } },
 *     // every variant gets the SAME pricing block
 *     variants: [{ ...variantFields, basePrice, originalPrice, finalPrice, discountAmount,
 *                  discountPercentage, hasDiscount, pricing: { ... } }]
 *   }
 */
export function enrichProductWithPricing(product) {
  if (!product) return product;
  const p = product.toObject ? product.toObject() : product;

  const productOfferActive = isProductDiscountActive(p.discount);
  const offerSummary = productOfferActive
    ? {
        active: true,
        type:        p.discount.type,
        value:       p.discount.value,
        maxDiscount: p.discount.maxDiscount ?? null,
        startsAt:    p.discount.startsAt ?? null,
        endsAt:      p.discount.endsAt ?? null,
      }
    : { active: false };

  // USD Money envelope helper. Mirrors the shape produced by
  // currency.service.js:buildPriceEnvelope so consumers can read `price.final`
  // regardless of whether currency conversion ran.
  const usdMoney = (amount) =>
    amount === undefined || amount === null
      ? undefined
      : {
          amount,
          currency: 'USD',
          formatted: `$${Number(amount).toFixed(2)}`,
          decimals: 2,
          rate: 1,
          rateProvider: 'system',
          rateDate: null,
          rateUnavailable: false,
        };

  const buildBlock = (pricing, source) => ({
    basePrice:           pricing.basePrice,
    listPrice:           pricing.listPrice,
    originalPrice:       pricing.originalPrice,
    finalPrice:          pricing.finalPrice,
    discountAmount:      pricing.discountAmount,
    discountPercentage:  pricing.discountPercentage,
    hasDiscount:         pricing.hasDiscount,
    pricing: {
      ...pricing,
      offer: offerSummary,
      source,
    },
    // legacy aliases — keep frontends that read displayX working
    displayOriginalPrice:       pricing.originalPrice,
    displayFinalPrice:          pricing.finalPrice,
    displayDiscountPercentage:  pricing.discountPercentage,
    // Typed Money envelope (USD). Replaced by convertProductPrices when a
    // non-USD currency is requested.
    price: {
      final:              usdMoney(pricing.finalPrice),
      original:           usdMoney(pricing.originalPrice),
      list:               usdMoney(pricing.listPrice),
      discountAmount:     usdMoney(pricing.discountAmount),
      discountPercentage: pricing.discountPercentage || 0,
      hasDiscount:        !!pricing.hasDiscount,
    },
  });

  const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;

  if (hasVariants) {
    const enrichedVariants = p.variants.map((v) => {
      const pricing = calculateFinalPrice({ product: p, variant: v });
      return { ...v, ...buildBlock(pricing, 'variant') };
    });

    const active = enrichedVariants.filter((v) => v.isActive !== false);
    const pool   = active.length > 0 ? active : enrichedVariants;
    const cheapest = pool.reduce(
      (best, cur) => (!best || cur.finalPrice < best.finalPrice ? cur : best),
      null
    );

    const rootPricing = cheapest
      ? {
          basePrice:          cheapest.basePrice,
          listPrice:          cheapest.listPrice,
          originalPrice:      cheapest.originalPrice,
          finalPrice:         cheapest.finalPrice,
          discountAmount:     cheapest.discountAmount,
          discountPercentage: cheapest.discountPercentage,
          hasDiscount:        cheapest.hasDiscount,
          breakdown:          cheapest.pricing?.breakdown,
        }
      : calculateFinalPrice({ product: p, variant: null });

    return {
      ...p,
      merchantPrice: rootPricing.basePrice,
      price:         rootPricing.basePrice,
      nubianMarkup:  cheapest?.nubianMarkup ?? p.nubianMarkup ?? 30,
      ...buildBlock(rootPricing, 'product'),
      variants: enrichedVariants,
    };
  }

  // No variants (orphan): defensive — schema doesn't allow this, but keep it safe.
  const pricing = calculateFinalPrice({ product: p, variant: null });
  return {
    ...p,
    merchantPrice: pricing.basePrice,
    price:         pricing.basePrice,
    ...buildBlock(pricing, 'product'),
  };
}


/**
 * Enrich array of products with pricing breakdown
 */
export function enrichProductsWithPricing(products) {
  if (!Array.isArray(products)) return products;
  return products.map(enrichProductWithPricing);
}

/**
 * Recursively find all descendant category IDs for a given parent
 */
async function getCategoryDescendants(parentId) {
  try {
    const children = await Category.find({ parent: parentId, isActive: true }).select('_id').lean();
    let ids = children.map(c => c._id);
    
    if (ids.length > 0) {
      const grandchildPromises = ids.map(id => getCategoryDescendants(id));
      const grandchildResults = await Promise.all(grandchildPromises);
      grandchildResults.forEach(gIds => {
        ids = [...ids, ...gIds];
      });
    }
    
    return ids;
  } catch (error) {
    logger.error('Error fetching category descendants', { parentId, error: error.message });
    return [];
  }
}

export const getProducts = async (req, res) => {
  try {
    // Pagination validation with max limits
    const MAX_LIMIT = 100;
    const MAX_PAGE = 10000;
    const DEFAULT_LIMIT = 100; // Maintain backward compatibility with existing API clients
    const page = Math.max(1, Math.min(parseInt(req.query.page) || 1, MAX_PAGE));
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT));
    const skip = (page - 1) * limit;

    const { category, merchant } = req.query;

    // Log request parameters for debugging
    logger.info('getProducts request', {
      category,
      merchant,
      page,
      limit,
      skip,
      queryParams: req.query,
    });

    // Get user preferred categories for personalization (optional, safe fallback)
    const preferredCategories = getUserPreferredCategories(req);

    // Build filter - values are already validated as MongoDB ObjectIds by middleware
    const filter = {
      // Use $ne: false to also match legacy products where isActive was never written
      // (old schema did not declare isActive, so strict mode prevented saves via document.save())
      isActive: { $ne: false },
      deletedAt: null, // Exclude soft-deleted products
    };

    // Handle hierarchical categories: if category has children, include all subcategories recursively
    if (category) {
      try {
        const categoryId = new mongoose.Types.ObjectId(category);

        // Fetch ALL levels of descendants recursively
        const descendantIds = await getCategoryDescendants(categoryId);

        // Build array of category IDs: parent + all descendants
        const categoryIds = [categoryId, ...descendantIds];

        // Use $in to match products in parent category OR any child/grandchild category
        filter.category = { $in: categoryIds };

        logger.info('Category filter with recursive descendants', {
          categoryId: category,
          totalCategoryCount: categoryIds.length,
          requestId: req.requestId,
        });
      } catch (e) {
        logger.warn('Invalid category ID provided', { category, error: e.message, requestId: req.requestId });
        filter.category = new mongoose.Types.ObjectId(); // Non-matching random ObjectId
      }
    }

    if (merchant) {
      try {
        filter.merchant = new mongoose.Types.ObjectId(merchant);
      } catch (e) {
        logger.warn('Invalid merchant ID provided', { merchant, error: e.message, requestId: req.requestId });
        filter.merchant = new mongoose.Types.ObjectId(); // Non-matching random ObjectId
      }
    }

    // Calculate ranking using aggregation pipeline for efficient sorting
    // This ensures ranking is computed server-side and pagination works correctly
    const now = new Date();
    const FRESHNESS_MAX_DAYS = RANKING_CONSTANTS.FRESHNESS_MAX_DAYS;
    const FRESHNESS_BOOST_MAX = RANKING_CONSTANTS.FRESHNESS_BOOST_MAX;
    const STOCK_BOOST_THRESHOLD = RANKING_CONSTANTS.STOCK_BOOST_THRESHOLD;
    const STOCK_BOOST_MAX = RANKING_CONSTANTS.STOCK_BOOST_MAX;
    const PERSONALIZATION_BOOST = RANKING_CONSTANTS.PERSONALIZATION_BOOST;
    const FEATURED_BOOST = RANKING_CONSTANTS.FEATURED_BOOST;
    const PRIORITY_WEIGHT = RANKING_CONSTANTS.PRIORITY_WEIGHT;

    // Convert preferred categories to ObjectIds for matching
    const preferredCategoryIds = preferredCategories.map(cat => {
      try {
        return new mongoose.Types.ObjectId(cat);
      } catch (e) {
        return null;
      }
    }).filter(id => id !== null);

    // Build aggregation pipeline for ranking computation
    const pipeline = [
      // Match filter (same as before)
      { $match: filter },

      // Add computed ranking fields
      {
        $addFields: {
          // Featured boost (admin-controlled)
          featuredBoost: {
            $cond: [{ $ifNull: ['$featured', false] }, FEATURED_BOOST, 0]
          },

          // Priority boost (admin-controlled)
          priorityBoost: {
            $multiply: [
              { $ifNull: ['$priorityScore', 0] },
              PRIORITY_WEIGHT
            ]
          },

          // Freshness boost (days since creation)
          daysSinceCreation: {
            $divide: [
              { $subtract: [now, '$createdAt'] },
              1000 * 60 * 60 * 24 // Convert milliseconds to days
            ]
          },

          // Stock boost: sum stock from all active variants
          stockValue: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: { $ifNull: ['$variants', []] },
                    as: 'v',
                    cond: { $ne: ['$$v.isActive', false] }
                  }
                },
                as: 'av',
                in: { $ifNull: ['$$av.stock', 0] }
              }
            }
          },
        }
      },

      // Calculate freshness boost
      {
        $addFields: {
          freshnessBoost: {
            $cond: [
              { $lte: ['$daysSinceCreation', FRESHNESS_MAX_DAYS] },
              {
                $max: [
                  0,
                  {
                    $round: {
                      $multiply: [
                        FRESHNESS_BOOST_MAX,
                        {
                          $subtract: [
                            1,
                            { $divide: ['$daysSinceCreation', FRESHNESS_MAX_DAYS] }
                          ]
                        }
                      ]
                    }
                  }
                ]
              },
              0
            ]
          }
        }
      },

      // Calculate stock boost
      {
        $addFields: {
          stockBoost: {
            $cond: [
              { $gte: ['$stockValue', STOCK_BOOST_THRESHOLD] },
              {
                $round: {
                  $multiply: [
                    STOCK_BOOST_MAX,
                    {
                      $min: [
                        1,
                        {
                          $divide: [
                            { $min: ['$stockValue', STOCK_BOOST_THRESHOLD * 2] },
                            STOCK_BOOST_THRESHOLD * 2
                          ]
                        }
                      ]
                    }
                  ]
                }
              },
              0
            ]
          }
        }
      }
    ];

    // Add personalization boost stage only if we have preferred categories
    if (preferredCategoryIds.length > 0) {
      pipeline.push({
        $addFields: {
          personalizationBoost: {
            $cond: [
              { $in: ['$category', preferredCategoryIds] },
              PERSONALIZATION_BOOST,
              0
            ]
          }
        }
      });
    } else {
      // No preferred categories - set personalization boost to 0
      pipeline.push({
        $addFields: {
          personalizationBoost: 0
        }
      });
    }

    // Calculate total ranking score
    pipeline.push({
      $addFields: {
        rankingScore: {
          $add: [
            '$featuredBoost',
            '$priorityBoost',
            '$freshnessBoost',
            '$stockBoost',
            '$personalizationBoost'
          ]
        }
      }
    });

    // Sort by ranking score (descending), then by createdAt (descending) for tie-breaking
    pipeline.push({
      $sort: {
        rankingScore: -1,
        createdAt: -1
      }
    });

    // Add $lookup stages to populate merchant and category
    // NOTE: Merchant model is mapped to the `merchantapplications` collection — see merchant.model.js
    pipeline.push({
      $lookup: {
        from: 'merchantapplications',
        localField: 'merchant',
        foreignField: '_id',
        as: 'merchantData'
      }
    });
    pipeline.push({
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categoryData'
      }
    });

    // Unwind and reshape the populated fields
    pipeline.push({
      $addFields: {
        merchant: {
          $cond: {
            if: { $gt: [{ $size: '$merchantData' }, 0] },
            then: {
              _id: { $arrayElemAt: ['$merchantData._id', 0] },
              storeName: { $arrayElemAt: ['$merchantData.storeName', 0] },
              email: { $arrayElemAt: ['$merchantData.email', 0] },
              logoUrl: { $arrayElemAt: ['$merchantData.logoUrl', 0] },
              status: { $arrayElemAt: ['$merchantData.status', 0] }
            },
            else: null
          }
        },
        category: {
          $cond: {
            if: { $gt: [{ $size: '$categoryData' }, 0] },
            then: {
              _id: { $arrayElemAt: ['$categoryData._id', 0] },
              name: { $arrayElemAt: ['$categoryData.name', 0] }
            },
            else: null
          }
        }
      }
    });

    // Remove temporary lookup arrays
    pipeline.push({
      $project: {
        merchantData: 0,
        categoryData: 0
      }
    });

    // Skip and limit for pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    // Execute aggregation
    const populatedProducts = await Product.aggregate(pipeline);

    // Get total count for pagination
    const totalProducts = await Product.countDocuments(filter);

    // Enrich products with pricing breakdown
    const enrichedProducts = enrichProductsWithPricing(populatedProducts);

    // Apply currency conversion if currencyCode is provided
    const currencyCode = req.currencyCode;
    let finalProducts = enrichedProducts;

    if (currencyCode && currencyCode.toUpperCase() !== 'USD') {
      try {
        // PERF: Fetch rate and config ONCE for all products
        const upperCode = currencyCode.toUpperCase();

        // Dynamic import to avoid circular dep issues if any, or just direct import
        // We need: Currency model and getLatestRate service
        const Currency = (await import('../models/currency.model.js')).default;
        const { getLatestRate } = await import('../services/fx.service.js');

        const [currencyConfig, rateInfo] = await Promise.all([
          Currency.findOne({ code: upperCode }).lean(),
          getLatestRate(upperCode)
        ]);

        const currencyContext = {
          config: currencyConfig,
          rate: rateInfo
        };

        finalProducts = await Promise.all(
          enrichedProducts.map(product => convertProductPrices(product, currencyCode, currencyContext))
        );
        logger.debug('Applied currency conversion to products (optimized)', {
          currencyCode,
          productCount: finalProducts.length,
        });
      } catch (conversionError) {
        logger.warn('Currency conversion failed, returning USD prices', {
          currencyCode,
          error: conversionError.message,
        });
        // Fall back to USD prices if conversion fails
        finalProducts = enrichedProducts;
      }
    }

    logger.info('Products retrieved with ranking', {
      requestId: req.requestId,
      total: totalProducts,
      returned: finalProducts.length,
      page,
      limit,
      hasPersonalization: preferredCategories.length > 0,
      categoryFilter: category || 'none',
      merchantFilter: merchant || 'none',
      currencyCode: currencyCode || 'USD',
    });



    return sendPaginated(res, {
      data: finalProducts,
      page,
      limit,
      total: totalProducts,
      message: 'Products retrieved successfully',
    });
  } catch (error) {
    logger.error('Error retrieving products with ranking', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    // Let error handler middleware handle the response
    throw error;
  }
};


export const getProductById = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      deletedAt: null, // Exclude soft-deleted products
    })
      .populate('merchant', 'storeName email logoUrl city status')
      .populate('category', 'name');

    if (!product) {
      return sendNotFound(res, 'Product');
    }

    // Return product even if inactive (for admin/merchant viewing)
    // Frontend can check isActive to handle display

    // Enrich product with pricing breakdown
    let enrichedProduct = enrichProductWithPricing(product);

    // Apply currency conversion
    const currencyCode = req.currencyCode;
    if (currencyCode && currencyCode !== 'USD') {
      try {
        enrichedProduct = await convertProductPrices(enrichedProduct, currencyCode);
      } catch (conversionError) {
        logger.warn('Currency conversion failed for product', {
          productId: req.params.id,
          currencyCode,
          error: conversionError.message,
        });
        // Fall back to USD prices
      }
    }

    return sendSuccess(res, {
      data: enrichedProduct,
      message: 'Product retrieved successfully',
    });
  } catch (error) {
    // Let error handler middleware handle the response
    throw error;
  }
}

// ===== Helper: Sanitize product-level discount input =====
// Coerces dashboard input into the schema shape and rejects garbage.
// Returns null when the block is empty or invalid (treat as "no discount").
const sanitizeDiscountInput = (input) => {
  if (!input || typeof input !== 'object') return null;

  const type = input.type === 'percentage' || input.type === 'fixed' ? input.type : null;
  const value = Number(input.value);
  if (!type || !(value > 0)) return null;

  const out = {
    type,
    value: type === 'percentage' ? Math.min(value, 100) : value,
    isActive: input.isActive !== false,
  };
  if (input.maxDiscount !== undefined && Number(input.maxDiscount) > 0) {
    out.maxDiscount = Number(input.maxDiscount);
  }
  if (input.startsAt) {
    const d = new Date(input.startsAt);
    if (!isNaN(d.getTime())) out.startsAt = d;
  }
  if (input.endsAt) {
    const d = new Date(input.endsAt);
    if (!isNaN(d.getTime())) out.endsAt = d;
  }
  if (out.startsAt && out.endsAt && out.startsAt > out.endsAt) return null;
  return out;
};

// ===== Helper: Validate Variants =====
const validateVariants = (variants) => {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw { message: 'Product must have at least one variant', statusCode: 400, code: 'VALIDATION_ERROR' };
  }

  const skus = new Set();
  for (const variant of variants) {
    variant.sku = variant.sku?.trim().toUpperCase();
    if (!variant.sku) throw { message: 'All variants must have a SKU', statusCode: 400, code: 'VALIDATION_ERROR' };
    if (skus.has(variant.sku)) throw { message: `Duplicate SKU found: ${variant.sku}`, statusCode: 400, code: 'VALIDATION_ERROR' };
    skus.add(variant.sku);

    // Validate attributes: must be a non-empty object (any attributes allowed, not just size/color)
    if (
      !variant.attributes ||
      typeof variant.attributes !== 'object' ||
      Array.isArray(variant.attributes) ||
      Object.keys(variant.attributes).length === 0
    ) {
      throw { message: 'Each variant must have at least one attribute (e.g. size, color)', statusCode: 400, code: 'VALIDATION_ERROR' };
    }

    if (variant.merchantPrice === undefined || variant.merchantPrice <= 0) {
      throw { message: 'Variant merchantPrice is required and must be > 0', statusCode: 400, code: 'VALIDATION_ERROR' };
    }

    if (variant.stock === undefined || variant.stock < 0) {
      throw { message: 'Variant stock is required and cannot be negative', statusCode: 400, code: 'VALIDATION_ERROR' };
    }
  }
};

// ===== Helper: Validate ObjectId =====
const validateObjectId = (id, type) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw { message: `Invalid ${type} ID format`, statusCode: 400, code: 'VALIDATION_ERROR' };
  }
  return new mongoose.Types.ObjectId(id);
};

// ===== CREATE PRODUCT =====
export const createProduct = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return sendError(res, { message: 'Unauthorized', statusCode: 401, code: 'UNAUTHORIZED' });

    let userRole;
    try {
      const user = await clerkClient.users.getUser(userId);
      userRole = user.publicMetadata?.role;
    } catch (error) {
      return sendError(res, { message: 'Failed to verify user permissions', statusCode: 500, code: 'CLERK_ERROR' });
    }

    if (!['admin', 'merchant'].includes(userRole)) {
      return sendError(res, { message: 'Only admins and approved merchants can create products', statusCode: 403, code: 'FORBIDDEN' });
    }

    if (req.merchant) req.body.merchant = req.merchant._id;

    if (!req.body.category) return sendError(res, { message: 'Category is required', statusCode: 400, code: 'VALIDATION_ERROR' });
    if (!req.body.images || !Array.isArray(req.body.images) || req.body.images.length === 0) {
      return sendError(res, { message: 'At least one image is required', statusCode: 400, code: 'VALIDATION_ERROR' });
    }

    // Validate Variants
    validateVariants(req.body.variants);

    // Remove legacy product-level price fields. Note: req.body.discount (the
    // product-wide discount block) is INTENTIONALLY preserved here — it is the
    // single knob that propagates a discount to every variant via the engine.
    delete req.body.price;
    delete req.body.merchantPrice;
    delete req.body.discountPrice;

    if (req.body.discount) req.body.discount = sanitizeDiscountInput(req.body.discount);

    // Validate Category & Merchant ObjectIds
    req.body.category = validateObjectId(req.body.category, 'category');
    if (req.body.merchant) req.body.merchant = validateObjectId(req.body.merchant, 'merchant');

    const product = await Product.create(req.body);

    // Populate and enrich pricing
    const populatedProduct = await Product.findById(product._id)
      .populate([
        { path: 'merchant', select: 'storeName email logoUrl city status' },
        { path: 'category', select: 'name' }
      ]);

    const enrichedProduct = enrichProductWithPricing(populatedProduct);

    return sendCreated(res, enrichedProduct, 'Product created successfully');
  } catch (error) {
    logger.error('Error creating product', { error: error.message });
    if (error.code === 11000 && error.keyPattern?.['variants.sku']) {
      return sendError(res, { message: `Duplicate SKU detected at DB level`, statusCode: 400, code: 'VALIDATION_ERROR' });
    }
    return sendError(res, { message: error.message || 'Internal Server Error', statusCode: error.statusCode || 500, code: error.code || 'SERVER_ERROR' });
  }
};

// ===== UPDATE PRODUCT =====
export const updateProduct = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const product = await Product.findById(req.params.id);

    if (!product || product.deletedAt) return sendNotFound(res, 'Product');

    if (userId) {
      try {
        const user = await clerkClient.users.getUser(userId);
        if (user.publicMetadata?.role === 'merchant') {
          const merchant = await Merchant.findOne({ userId, status: 'approved' });
          if (merchant && product.merchant?.toString() !== merchant._id.toString()) {
            return sendForbidden(res, 'You can only update your own products');
          }
        }
      } catch (error) {
        // Ignore clerk errors
      }
    }

    // Validate category & merchant if provided
    if (req.body.category) req.body.category = validateObjectId(req.body.category, 'category');
    if (req.body.merchant) req.body.merchant = validateObjectId(req.body.merchant, 'merchant');

    // Validate Variants if provided
    if (req.body.variants) validateVariants(req.body.variants);

    // Strip legacy root price fields, keep req.body.discount (product-wide discount).
    delete req.body.price;
    delete req.body.merchantPrice;
    delete req.body.discountPrice;

    if (req.body.discount !== undefined) {
      req.body.discount = sanitizeDiscountInput(req.body.discount);
    }

    product.set(req.body);
    if (req.body.variants) product.markModified('variants');

    const updatedProduct = await product.save();

    await updatedProduct.populate([
      { path: 'merchant', select: 'storeName email logoUrl city status' },
      { path: 'category', select: 'name' }
    ]);

    const enrichedProduct = enrichProductWithPricing(updatedProduct);

    return sendSuccess(res, { data: enrichedProduct, message: 'Product updated successfully' });
  } catch (error) {
    logger.error('Error updating product', { error: error.message });
    if (error.code === 11000 && error.keyPattern?.['variants.sku']) {
      return sendError(res, { message: `Duplicate SKU detected at DB level`, statusCode: 400, code: 'VALIDATION_ERROR' });
    }
    return sendError(res, { message: error.message || 'Internal Server Error', statusCode: error.statusCode || 500, code: error.code || 'SERVER_ERROR' });
  }
};



export const deleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    logger.info('Delete product request', {
      requestId: req.requestId,
      productId,
      productIdLength: productId?.length,
      productIdFormat: /^[0-9a-fA-F]{24}$/.test(productId) ? 'valid' : 'invalid',
    });

    const { userId } = getAuth(req);

    // 1) نجيب المنتج للتحقق (ملكية التاجر + هل محذوف مسبقاً)
    const product = await Product.findOne({
      _id: productId,
      deletedAt: null,
    });

    if (!product) {
      return sendNotFound(res, 'Product');
    }

    // 2) نفس منطق الملكية للتاجر (زي كودك الحالي)
    if (userId) {
      try {
        const user = await clerkClient.users.getUser(userId);
        if (user.publicMetadata?.role === 'merchant') {
          const merchant = await Merchant.findOne({ userId, status: 'approved' });
          if (merchant && product.merchant?.toString() !== merchant._id.toString()) {
            return sendForbidden(res, 'You can only delete your own products');
          }
        }
      } catch (error) {
        // Ignore Clerk errors — best-effort ownership check
      }
    }

    // 3) Soft delete بتحديث مباشر بدون save() => بدون validators
    // IMPORTANT: ما تستخدم product.save()
    await Product.updateOne(
      { _id: productId },
      {
        $set: {
          deletedAt: new Date(),
          isActive: false, // اختياري لكن مفيد: المنتج المحذوف ما يظهر حتى لو فلتر isActive
        },
      },
      { runValidators: false } // للتأكيد
    );

    logger.info('Product soft deleted (no validation)', {
      requestId: req.requestId,
      productId,
      userId,
    });

    return sendSuccess(res, {
      message: 'Product deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting product', {
      requestId: req.requestId,
      productId: req.params.id,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    throw error;
  }
};


// Get merchant's products
export const getMerchantProducts = async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const merchant = await Merchant.findOne({ userId, status: 'approved' });
    if (!merchant) {
      return res.status(403).json({ message: 'Merchant not found or not approved' });
    }

    const MAX_LIMIT = 100;
    const MAX_PAGE = 10000;
    const DEFAULT_LIMIT = 100;
    const page = Math.max(1, Math.min(parseInt(req.query.page) || 1, MAX_PAGE));
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT));
    const skip = (page - 1) * limit;

    const { category, isActive } = req.query;

    // Build filter - category is validated as MongoDB ObjectId by middleware
    const filter = {
      merchant: merchant._id,
      deletedAt: null, // Exclude soft-deleted products
    };
    if (category) {
      try {
        const categoryId = new mongoose.Types.ObjectId(category);
        const descendantIds = await getCategoryDescendants(categoryId);
        const categoryIds = [categoryId, ...descendantIds];
        filter.category = { $in: categoryIds };
      } catch (e) {
        filter.category = new mongoose.Types.ObjectId();
      }
    }
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    const products = await Product.find(filter)
      .populate('category', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalProducts = await Product.countDocuments(filter);

    // Enrich products with pricing breakdown
    const enrichedProducts = enrichProductsWithPricing(products);

    return sendPaginated(res, {
      data: enrichedProducts,
      page,
      limit,
      total: totalProducts,
      message: 'Merchant products retrieved successfully',
    });
  } catch (error) {
    // Let error handler middleware handle the response
    throw error;
  }
}

// ============================================
// ADMIN PRODUCT MANAGEMENT ENDPOINTS
// ============================================

/**
 * Admin: Get all products from all merchants with advanced filtering
 * Allows admins to see all products including inactive and soft-deleted ones
 */
export const getAllProductsAdmin = async (req, res) => {
  try {
    // Pagination validation with max limits
    const MAX_LIMIT = 100;
    const MAX_PAGE = 10000;
    const DEFAULT_LIMIT = 50;
    const page = Math.max(1, Math.min(parseInt(req.query.page) || 1, MAX_PAGE));
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT));
    const skip = (page - 1) * limit;

    const {
      category,
      merchant,
      isActive,
      includeDeleted,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter - admin can see all products including inactive/deleted
    const filter = {};

    // Include soft-deleted products only if explicitly requested
    if (includeDeleted !== 'true') {
      filter.deletedAt = null;
    }

    if (category) {
      try {
        const categoryId = new mongoose.Types.ObjectId(category);
        const descendantIds = await getCategoryDescendants(categoryId);
        const categoryIds = [categoryId, ...descendantIds];
        filter.category = { $in: categoryIds };
      } catch (e) {
        filter.category = new mongoose.Types.ObjectId();
      }
    }
    if (merchant) {
      filter.merchant = merchant;
    }
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    // Text search on name and description
    if (search && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    // Build sort object
    const sort = {};
    const validSortFields = ['createdAt', 'name', 'price', 'averageRating', 'isActive', 'priorityScore', 'featured'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';

    // Special handling for featured/priorityScore combo (admin ranking view)
    if (sortBy === 'priorityScore' || sortBy === 'featured') {
      // Sort by featured first (boolean), then priorityScore, then createdAt
      sort.featured = -1; // Featured products first
      sort.priorityScore = sortOrder === 'asc' ? 1 : -1;
      sort.createdAt = -1; // Tie-breaker
    } else {
      sort[sortField] = sortOrder === 'asc' ? 1 : -1;
    }

    const products = await Product.find(filter)
      .populate('merchant', 'storeName email logoUrl city status')
      .populate('category', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const totalProducts = await Product.countDocuments(filter);
    const absoluteTotal = await Product.countDocuments({}); // Check if DB is empty

    // DEBUG LOGGING
    logger.info('DEBUG: getAllProductsAdmin', {
      filter,
      totalFound: totalProducts,
      absoluteTotalInDB: absoluteTotal,
      paramIsActive: isActive,
      paramIncludeDeleted: includeDeleted
    });

    // Enrich products with pricing breakdown
    const enrichedProducts = enrichProductsWithPricing(products);

    logger.info('Admin retrieved all products', {
      requestId: req.requestId,
      userId: getAuth(req).userId,
      total: totalProducts,
      page,
      limit,
      filters: { category, merchant, isActive, includeDeleted, search },
    });

    return sendPaginated(res, {
      data: enrichedProducts,
      page,
      limit,
      total: totalProducts,
      message: 'All products retrieved successfully',
    });
  } catch (error) {
    logger.error('Error in getAllProductsAdmin', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Admin: Enable/disable product visibility
 * Toggles isActive flag without deleting the product
 */
export const toggleProductActive = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return sendError(res, {
        message: 'isActive must be a boolean value',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    const product = await Product.findOne({ _id: id, deletedAt: null });
    if (!product) {
      return sendNotFound(res, 'Product');
    }

    // Use updateOne to avoid triggering the pre-save pricing middleware on variants
    await Product.updateOne(
      { _id: id },
      { $set: { isActive } },
      { runValidators: false }
    );

    logger.info('Product active status toggled by admin', {
      requestId: req.requestId,
      userId,
      productId: product._id,
      isActive,
    });

    // Populate for response
    const populatedProduct = await Product.findById(product._id)
      .populate('merchant', 'storeName email logoUrl city status')
      .populate('category', 'name');

    return sendSuccess(res, {
      data: populatedProduct,
      message: `Product ${isActive ? 'enabled' : 'disabled'} successfully`,
    });
  } catch (error) {
    logger.error('Error toggling product active status', {
      requestId: req.requestId,
      productId: req.params.id,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Admin: Restore soft-deleted product
 */
export const restoreProduct = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;

    const product = await Product.findOne({
      _id: id,
      deletedAt: { $ne: null }, // Only find soft-deleted products
    });

    if (!product) {
      return sendNotFound(res, 'Deleted product');
    }

    // Use updateOne to avoid triggering pricing middleware on variants
    await Product.updateOne(
      { _id: id },
      { $set: { deletedAt: null, isActive: true } },
      { runValidators: false }
    );

    logger.info('Product restored by admin', {
      requestId: req.requestId,
      userId,
      productId: product._id,
    });

    const populatedProduct = await Product.findById(product._id)
      .populate('merchant', 'storeName email logoUrl city status')
      .populate('category', 'name');

    return sendSuccess(res, {
      data: populatedProduct,
      message: 'Product restored successfully',
    });
  } catch (error) {
    logger.error('Error restoring product', {
      requestId: req.requestId,
      productId: req.params.id,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Admin: Hard delete product (permanent deletion)
 * Only admins can hard delete. Use with caution.
 */
export const hardDeleteProduct = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;

    const product = await Product.findById(id);

    if (!product) {
      return sendNotFound(res, 'Product');
    }

    // Log before deletion for audit trail
    logger.warn('Product hard deleted by admin', {
      requestId: req.requestId,
      userId: userId,
      productId: product._id,
      productName: product.name,
      merchantId: product.merchant,
    });

    await Product.findByIdAndDelete(id);

    return sendSuccess(res, {
      message: 'Product permanently deleted',
    });
  } catch (error) {
    logger.error('Error hard deleting product', {
      requestId: req.requestId,
      productId: req.params.id,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Admin: Update product ranking fields (priorityScore and featured)
 * This endpoint allows admins to control product ranking/ordering
 */
export const updateProductRanking = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;
    const { priorityScore, featured } = req.body;

    // Validate that at least one ranking field is provided
    if (priorityScore === undefined && featured === undefined) {
      return sendError(res, {
        message: 'At least one ranking field (priorityScore or featured) must be provided',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    // Validate priorityScore if provided
    if (priorityScore !== undefined) {
      const score = parseInt(priorityScore);
      if (isNaN(score) || score < 0 || score > 100) {
        return sendError(res, {
          message: 'priorityScore must be a number between 0 and 100',
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        });
      }
    }

    // Validate featured if provided
    if (featured !== undefined && typeof featured !== 'boolean') {
      return sendError(res, {
        message: 'featured must be a boolean value',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    const product = await Product.findOne({ _id: id, deletedAt: null });
    if (!product) return sendNotFound(res, 'Product');

    // Build update — use updateOne to avoid triggering pre-save pricing middleware
    const update = {};
    if (priorityScore !== undefined) update.priorityScore = parseInt(priorityScore);
    if (featured !== undefined) update.featured = featured;

    await Product.updateOne({ _id: id }, { $set: update }, { runValidators: false });

    logger.info('Product ranking updated by admin', {
      requestId: req.requestId,
      userId,
      productId: product._id,
      update,
    });

    const populatedProduct = await Product.findById(product._id)
      .populate('merchant', 'storeName email logoUrl city status')
      .populate('category', 'name');

    return sendSuccess(res, {
      data: populatedProduct,
      message: 'Product ranking updated successfully',
    });
  } catch (error) {
    logger.error('Error updating product ranking', {
      requestId: req.requestId,
      productId: req.params.id,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Admin: Toggle dynamic pricing for a product
 * When disabled, dynamicMarkup is frozen at 0 — price = merchantPrice × (1 + nubianMarkup/100)
 * PATCH /api/products/:id/dynamic-pricing
 * Body: { enabled: boolean, nubianMarkup?: number }
 */
export const toggleDynamicPricing = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;
    const { enabled, nubianMarkup } = req.body;

    if (typeof enabled !== 'boolean') {
      return sendError(res, {
        message: 'enabled must be a boolean',
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    if (nubianMarkup !== undefined) {
      const nm = Number(nubianMarkup);
      if (!Number.isFinite(nm) || nm < 0 || nm > 200) {
        return sendError(res, {
          message: 'nubianMarkup must be a number between 0 and 200',
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        });
      }
    }

    const product = await Product.findOne({ _id: id, deletedAt: null });
    if (!product) return sendNotFound(res, 'Product');

    // Build top-level update
    const update = { dynamicPricingEnabled: enabled };

    // If disabling, freeze dynamicMarkup at 0 on all variants immediately
    // If enabling, the cron will recalculate on next run
    const variantUpdates = {};
    if (!enabled) {
      product.variants.forEach((v, idx) => {
        variantUpdates[`variants.${idx}.dynamicMarkup`] = 0;
      });
    }

    // If admin also overrides nubianMarkup, apply to all variants
    if (nubianMarkup !== undefined) {
      product.variants.forEach((_, idx) => {
        variantUpdates[`variants.${idx}.nubianMarkup`] = Number(nubianMarkup);
      });
    }

    // Compute updated finalPrices immediately (so UI is instant, no wait for cron).
    // Engine respects product.discount + product.dynamicPricingEnabled, so we
    // mirror this temporary toggle into a synthetic product context.
    if (!enabled || nubianMarkup !== undefined) {
      const ctx = {
        ...product.toObject(),
        dynamicPricingEnabled: enabled,
      };
      product.variants.forEach((v, idx) => {
        const nm = nubianMarkup !== undefined ? Number(nubianMarkup) : (v.nubianMarkup ?? 30);
        const dm = enabled ? (v.dynamicMarkup ?? 0) : 0;
        const { finalPrice: newFinal } = calculateFinalPrice({
          product: ctx,
          variant: { ...v.toObject?.() ?? v, nubianMarkup: nm, dynamicMarkup: dm },
        });
        variantUpdates[`variants.${idx}.finalPrice`] = newFinal;
      });
      const finals = product.variants
        .map((v, idx) => variantUpdates[`variants.${idx}.finalPrice`] || v.finalPrice || 0)
        .filter((n) => n > 0);
      if (finals.length) update.finalPrice = Math.min(...finals);
    }

    await Product.updateOne(
      { _id: id },
      { $set: { ...update, ...variantUpdates } },
      { runValidators: false }
    );

    logger.info('Product dynamic pricing toggled by admin', {
      requestId: req.requestId,
      userId,
      productId: id,
      enabled,
      nubianMarkup,
    });

    const populatedProduct = await Product.findById(id)
      .populate('merchant', 'storeName email logoUrl city status')
      .populate('category', 'name');

    return sendSuccess(res, {
      data: populatedProduct,
      message: `Dynamic pricing ${enabled ? 'enabled' : 'disabled'} for product`,
    });
  } catch (error) {
    logger.error('Error toggling dynamic pricing', {
      requestId: req.requestId,
      productId: req.params.id,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Admin / Merchant: bulk import products via upsert by (merchant, importSku).
 *
 * The dashboard handles file parsing, validation, and image upload to ImageKit;
 * it sends a normalized array of rows here. We do schema-level validation and
 * a single Mongo bulkWrite for performance — large imports stay fast.
 *
 * Body shape:
 *   {
 *     merchantId: string (ObjectId),
 *     rows: Array<{
 *       importSku: string,
 *       name: string,
 *       description: string,
 *       category: string (ObjectId),
 *       images: string[],
 *       variants: Array<{ sku, attributes, merchantPrice, stock, images?, isActive? }>,
 *       priorityScore?: number,
 *       featured?: boolean,
 *     }>
 *   }
 *
 * Response:
 *   { success, totalRows, insertedCount, updatedCount, failedCount, failures: [{ index, importSku, reason }] }
 */
export const bulkImportProducts = async (req, res) => {
  const { merchantId, rows } = req.body || {};

  if (!merchantId || !mongoose.Types.ObjectId.isValid(merchantId)) {
    return sendError(res, {
      message: 'merchantId is required and must be a valid ObjectId',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return sendError(res, {
      message: 'rows must be a non-empty array',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  }

  // Verify the merchant exists. Admins can import for any approved merchant;
  // approved merchants can only import for themselves.
  const merchant = await Merchant.findById(merchantId).lean();
  if (!merchant) {
    return sendNotFound(res, 'Merchant');
  }

  const callerRole = req.adminUser?.role; // set by isAdmin
  if (callerRole !== 'admin' && callerRole !== 'support') {
    // Approved merchant path — must own the merchantId
    if (!req.merchant || req.merchant._id.toString() !== merchantId) {
      return sendForbidden(res, 'You can only import to your own merchant account');
    }
  }

  const merchantObjectId = new mongoose.Types.ObjectId(merchantId);
  const failures = [];
  const ops = [];

  rows.forEach((row, idx) => {
    try {
      if (!row.importSku || typeof row.importSku !== 'string') {
        throw new Error('importSku is required');
      }
      if (!row.name || typeof row.name !== 'string') {
        throw new Error('name is required');
      }
      if (!row.category || !mongoose.Types.ObjectId.isValid(row.category)) {
        throw new Error('category must be a valid ObjectId');
      }
      if (!Array.isArray(row.images) || row.images.length === 0) {
        throw new Error('At least one image is required');
      }

      // Variants are required by the Product schema.
      if (!Array.isArray(row.variants) || row.variants.length === 0) {
        throw new Error('At least one variant is required');
      }
      const seenSkus = new Set();
      for (const v of row.variants) {
        if (!v.sku) throw new Error('Each variant must have a SKU');
        const sku = String(v.sku).trim().toUpperCase();
        if (seenSkus.has(sku)) throw new Error(`Duplicate variant SKU within row: ${sku}`);
        seenSkus.add(sku);
        if (!v.attributes || typeof v.attributes !== 'object' || Object.keys(v.attributes).length === 0) {
          throw new Error('Each variant must have at least one attribute');
        }
        if (!(v.merchantPrice > 0)) {
          throw new Error('Each variant must have merchantPrice > 0');
        }
        if (!(v.stock >= 0)) {
          throw new Error('Each variant must have stock >= 0');
        }
      }

      const update = {
        name: row.name.trim(),
        description: row.description?.trim() || row.name.trim(),
        category: new mongoose.Types.ObjectId(row.category),
        images: row.images,
        merchant: merchantObjectId,
        variants: row.variants.map((v) => ({
          sku: String(v.sku).trim().toUpperCase(),
          attributes: v.attributes,
          merchantPrice: Number(v.merchantPrice),
          nubianMarkup: v.nubianMarkup ?? 30,
          dynamicMarkup: v.dynamicMarkup ?? 0,
          merchantDiscount: v.merchantDiscount ?? 0,
          stock: Number(v.stock),
          images: Array.isArray(v.images) ? v.images : [],
          isActive: v.isActive !== false,
        })),
        isActive: true,
        deletedAt: null,
        ...(row.priorityScore !== undefined ? { priorityScore: Number(row.priorityScore) } : {}),
        ...(row.featured !== undefined ? { featured: Boolean(row.featured) } : {}),
      };

      ops.push({
        updateOne: {
          filter: { merchant: merchantObjectId, importSku: row.importSku },
          update: {
            $set: update,
            $setOnInsert: { importSku: row.importSku, createdAt: new Date() },
          },
          upsert: true,
        },
      });
    } catch (e) {
      failures.push({ index: idx, importSku: row.importSku ?? null, reason: e.message });
    }
  });

  let insertedCount = 0;
  let updatedCount = 0;

  if (ops.length > 0) {
    try {
      // ordered:false so a row failing in the middle doesn't abort the rest
      const result = await Product.bulkWrite(ops, { ordered: false });
      insertedCount = result.upsertedCount || 0;
      updatedCount = result.modifiedCount || 0;
    } catch (err) {
      // Partial-failure path: extract per-write errors
      const writeErrors = err?.writeErrors || [];
      writeErrors.forEach((we) => {
        const opIdx = we.index ?? -1;
        const failedRowIdx =
          opIdx >= 0 && opIdx < rows.length
            ? rows.findIndex((r, i) => i === opIdx) // best-effort mapping
            : -1;
        failures.push({
          index: failedRowIdx,
          importSku: rows[failedRowIdx]?.importSku ?? null,
          reason: we.errmsg || 'Database write error',
        });
      });
      insertedCount = err?.result?.upsertedCount ?? 0;
      updatedCount = err?.result?.modifiedCount ?? 0;
    }
  }

  logger.info('Bulk product import completed', {
    requestId: req.requestId,
    merchantId,
    totalRows: rows.length,
    insertedCount,
    updatedCount,
    failedCount: failures.length,
  });

  return sendSuccess(res, {
    message: 'Bulk import completed',
    data: {
      success: failures.length === 0,
      totalRows: rows.length,
      insertedCount,
      updatedCount,
      failedCount: failures.length,
      failures,
    },
  });
};

/**
 * Explore products with advanced filtering and AI-powered ranking
 * GET /api/products/explore
 * 
 * Query params:
 * - page, limit: pagination
 * - sort: recommended|best_sellers|trending|new|price_low|price_high|rating
 * - Filters:
 *   - minPrice, maxPrice: price range
 *   - category: category ID
 *   - brand/store: merchant ID
 *   - size: size value
 *   - color: color value
 *   - discount: true/false (has discount)
 *   - minRating: minimum rating (0-5)
 *   - inStock: true/false (stock > 0)
 *   - fastDelivery: true/false (placeholder for future)
 *   - verifiedStore: true/false (merchant status = APPROVED)
 */
export const exploreProducts = async (req, res) => {
  try {
    const { userId } = getAuth(req);

    // Pagination
    const MAX_LIMIT = 50;
    const DEFAULT_LIMIT = 20;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT));
    const skip = (page - 1) * limit;

    // Sorting
    const sort = req.query.sort || 'recommended'; // recommended|best_sellers|trending|new|price_low|price_high|rating

    // Filters
    const {
      minPrice,
      maxPrice,
      category,
      brand, // merchant ID
      store, // merchant ID (alias for brand)
      size,
      color,
      discount,
      minRating,
      inStock,
      fastDelivery,
      verifiedStore,
    } = req.query;

    // Base filter
    const filter = {
      isActive: { $ne: false }, // Include legacy docs where isActive was never stored
      deletedAt: null,
    };

    // Price range filter - filter by finalPrice (smart pricing)
    // Use $or to match either finalPrice or legacy price/discountPrice
    if (minPrice || maxPrice) {
      const minPriceVal = minPrice ? parseFloat(minPrice) : null;
      const maxPriceVal = maxPrice ? parseFloat(maxPrice) : null;

      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          // Smart pricing: finalPrice
          ...(minPriceVal !== null || maxPriceVal !== null ? [{
            finalPrice: {
              ...(minPriceVal !== null ? { $gte: minPriceVal } : {}),
              ...(maxPriceVal !== null ? { $lte: maxPriceVal } : {}),
            }
          }] : []),
          // Legacy: discountPrice or price (if finalPrice not set)
          {
            $and: [
              { finalPrice: { $exists: false } },
              {
                $or: [
                  // Use discountPrice if exists, else price
                  {
                    $expr: {
                      $cond: [
                        { $gt: [{ $ifNull: ['$discountPrice', 0] }, 0] },
                        {
                          discountPrice: {
                            ...(minPriceVal !== null ? { $gte: minPriceVal } : {}),
                            ...(maxPriceVal !== null ? { $lte: maxPriceVal } : {}),
                          }
                        },
                        {
                          price: {
                            ...(minPriceVal !== null ? { $gte: minPriceVal } : {}),
                            ...(maxPriceVal !== null ? { $lte: maxPriceVal } : {}),
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        ]
      });
    }

    // Category filter - handle hierarchical categories recursively
    if (category) {
      try {
        const categoryId = new mongoose.Types.ObjectId(category);

        // Fetch ALL levels of descendants recursively
        const descendantIds = await getCategoryDescendants(categoryId);

        // Build array of category IDs: parent + all descendants
        const categoryIds = [categoryId, ...descendantIds];

        // Use $in to match products in parent category OR any child/grandchild category
        filter.category = { $in: categoryIds };

        logger.info('Explore category filter with recursive descendants', {
          categoryId: category,
          totalCategoryCount: categoryIds.length,
          requestId: req.requestId,
        });
      } catch (e) {
        // Invalid ObjectId or recursion failed, set non-matching filter
        logger.warn('Invalid category ID in explore, ensuring 0 results', { category, error: e.message });
        filter.category = new mongoose.Types.ObjectId(); 
      }
    }

    // Merchant/store filter (brand or store)
    const merchantId = brand || store;
    if (merchantId) {
      try {
        filter.merchant = new mongoose.Types.ObjectId(merchantId);
      } catch (e) {
        // Invalid ObjectId, skip filter
      }
    }

    // Verified store filter — pre-fetch approved IDs to avoid a $lookup join in the pipeline
    if (verifiedStore === 'true' || verifiedStore === 'false') {
      const approvedMerchants = await Merchant.find({ status: 'approved' }, '_id').lean();
      const approvedIds = approvedMerchants.map(m => m._id);
      filter.merchant = verifiedStore === 'true'
        ? { $in: approvedIds }
        : { $nin: approvedIds };
    }

    // Size filter - use $or for variants OR legacy sizes field
    if (size) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { 'variants.attributes.size': size },
          { sizes: size }
        ]
      });
    }

    // Color filter - use $or for variants OR legacy colors field
    if (color) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { 'variants.attributes.color': color },
          { colors: color }
        ]
      });
    }

    // Discount filter - check for discounts (finalPrice < merchantPrice OR discountPrice exists)
    if (discount === 'true') {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          // Smart pricing: finalPrice less than merchantPrice (discount)
          {
            $expr: {
              $and: [
                { $gt: [{ $ifNull: ['$finalPrice', 0] }, 0] },
                { $gt: [{ $ifNull: ['$merchantPrice', '$price', 0] }, 0] },
                { $lt: ['$finalPrice', { $ifNull: ['$merchantPrice', '$price'] }] }
              ]
            }
          },
          // Legacy: discountPrice exists
          { discountPrice: { $gt: 0 } },
          { 'variants.discountPrice': { $gt: 0 } }
        ]
      });
    }

    // Rating filter
    if (minRating) {
      filter.averageRating = { $gte: parseFloat(minRating) };
    }

    // Stock filter - use $or for main stock OR variant stock
    if (inStock === 'true') {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { stock: { $gt: 0 } },
          { 'variants.stock': { $gt: 0 } }
        ]
      });
    }

    // Get user preferences for personalization
    let preferredCategories = [];
    let viewedProductIds = [];
    let clickedProductIds = [];

    if (userId) {
      try {
        const activityEvents = await UserActivity.find({
          userId,
          event: { $in: ['product_view', 'product_click'] },
          productId: { $ne: null },
        })
          .sort({ timestamp: -1 })
          .limit(50)
          .select('productId categoryId event')
          .lean();

        const categoryIds = new Set();
        const productIdsNeedingCategory = [];

        activityEvents.forEach(ev => {
          if (ev.event === 'product_view') viewedProductIds.push(ev.productId.toString());
          else clickedProductIds.push(ev.productId.toString());

          if (ev.categoryId) {
            categoryIds.add(ev.categoryId.toString());
          } else {
            productIdsNeedingCategory.push(ev.productId);
          }
        });

        if (productIdsNeedingCategory.length > 0) {
          const activityProductDocs = await Product.find(
            { _id: { $in: productIdsNeedingCategory } },
            { category: 1 }
          ).lean();
          activityProductDocs.forEach(p => {
            if (p.category) categoryIds.add(p.category.toString());
          });
        }

        preferredCategories = Array.from(categoryIds);
      } catch (e) {
        logger.warn('Error loading user preferences for explore', { error: e.message });
      }
    }

    const now = new Date();
    const RANKING = RANKING_CONSTANTS;
    const preferredCategoryIds = preferredCategories.map(cat => {
      try {
        return new mongoose.Types.ObjectId(cat);
      } catch (e) {
        return null;
      }
    }).filter(id => id !== null);

    const viewedProductObjectIds = viewedProductIds.map(id => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch (e) {
        return null;
      }
    }).filter(id => id !== null);

    const clickedProductObjectIds = clickedProductIds.map(id => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch (e) {
        return null;
      }
    }).filter(id => id !== null);

    // Build aggregation pipeline
    const pipeline = [
      // Match base filter (merchant approval already baked in via pre-fetched IDs)
      { $match: filter },

      // Calculate ranking and affinity scores
      {
        $addFields: {
          // Ranking components
          featuredBoost: {
            $cond: [{ $ifNull: ['$featured', false] }, RANKING.FEATURED_BOOST, 0],
          },
          priorityBoost: {
            $multiply: [{ $ifNull: ['$priorityScore', 0] }, RANKING.PRIORITY_WEIGHT],
          },
          daysSinceCreation: {
            $divide: [{ $subtract: [now, '$createdAt'] }, 1000 * 60 * 60 * 24],
          },
          stockValue: { $ifNull: ['$stock', 0] },

          // User affinity (from views/clicks)
          userAffinityScore: {
            $cond: [
              { $in: ['$_id', clickedProductObjectIds] },
              20, // Clicks are worth more
              {
                $cond: [
                  { $in: ['$_id', viewedProductObjectIds] },
                  10, // Views get a smaller boost
                  0,
                ],
              },
            ],
          },

          // Trending boost (precomputed by productScoring cron)
          trendingBoost: { $ifNull: ['$ranking.visibilityScore', 0] },

          // Discount boost
          discountBoost: {
            $cond: [
              { $gt: [{ $ifNull: ['$discountPrice', 0] }, 0] },
              {
                $multiply: [
                  {
                    $divide: [
                      { $subtract: ['$price', { $ifNull: ['$discountPrice', '$price'] }] },
                      { $max: ['$price', 1] },
                    ],
                  },
                  50, // Max 50 points for discount
                ],
              },
              0,
            ],
          },

          // Personalization boost (preferred categories)
          personalizationBoost: {
            $cond: [
              {
                $and: [
                  { $gt: [preferredCategoryIds.length, 0] },
                  {
                    $in: ['$category', preferredCategoryIds],
                  },
                ],
              },
              RANKING.PERSONALIZATION_BOOST,
              0,
            ],
          },
        },
      },

      // Calculate freshness boost
      {
        $addFields: {
          freshnessBoost: {
            $cond: [
              { $lte: ['$daysSinceCreation', RANKING.FRESHNESS_MAX_DAYS] },
              {
                $max: [
                  0,
                  {
                    $multiply: [
                      {
                        $subtract: [
                          1,
                          {
                            $divide: ['$daysSinceCreation', RANKING.FRESHNESS_MAX_DAYS],
                          },
                        ],
                      },
                      RANKING.FRESHNESS_BOOST_MAX,
                    ],
                  },
                ],
              },
              0,
            ],
          },
          stockBoost: {
            $cond: [
              { $gte: ['$stockValue', RANKING.STOCK_BOOST_THRESHOLD] },
              {
                $min: [
                  RANKING.STOCK_BOOST_MAX,
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $min: ['$stockValue', RANKING.STOCK_BOOST_THRESHOLD * 2] },
                          RANKING.STOCK_BOOST_THRESHOLD * 2,
                        ],
                      },
                      RANKING.STOCK_BOOST_MAX,
                    ],
                  },
                ],
              },
              0,
            ],
          },
        },
      },

      // Calculate total explore score
      {
        $addFields: {
          exploreScore: {
            $add: [
              '$featuredBoost',
              '$priorityBoost',
              '$freshnessBoost',
              '$stockBoost',
              '$personalizationBoost',
              '$userAffinityScore',
              '$trendingBoost',
              '$discountBoost',
            ],
          },
        },
      },

      // Sort based on sort parameter
      {
        $sort: (() => {
          switch (sort) {
            case 'price_low':
              return { price: 1, exploreScore: -1 };
            case 'price_high':
              return { price: -1, exploreScore: -1 };
            case 'rating':
              return { averageRating: -1, exploreScore: -1 };
            case 'new':
              return { createdAt: -1, exploreScore: -1 };
            case 'trending':
              return { trendingBoost: -1, exploreScore: -1 };
            case 'best_sellers':
              return { orderCount: -1, exploreScore: -1 };
            case 'recommended':
            default:
              return { exploreScore: -1, trendingBoost: -1, createdAt: -1 };
          }
        })(),
      },

      // Pagination
      { $skip: skip },
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

    // Run aggregation and count in parallel — count is now a simple countDocuments
    const [products, total] = await Promise.all([
      Product.aggregate(pipeline),
      Product.countDocuments(filter),
    ]);

    // Enrich products with pricing breakdown
    const enrichedProducts = enrichProductsWithPricing(products);

    // Apply currency conversion if currencyCode is provided
    const currencyCode = req.currencyCode || req.query.currencyCode || req.query.currency;
    let finalProducts = enrichedProducts;

    if (currencyCode && currencyCode.toUpperCase() !== 'USD') {
      try {
        const upperCode = currencyCode.toUpperCase();

        // Dynamic import to avoid circular dep issues and ensure models are loaded
        const Currency = (await import('../models/currency.model.js')).default;
        const { getLatestRate } = await import('../services/fx.service.js');

        // Fetch rate and config ONCE
        const [currencyConfig, rateInfo] = await Promise.all([
          Currency.findOne({ code: upperCode }).lean(),
          getLatestRate(upperCode)
        ]);

        const currencyContext = {
          config: currencyConfig,
          rate: rateInfo
        };

        finalProducts = await Promise.all(
          enrichedProducts.map(product => convertProductPrices(product, currencyCode, currencyContext))
        );
        logger.debug('Applied currency conversion to explore products (optimized)', {
          currencyCode,
          productCount: finalProducts.length,
        });
      } catch (conversionError) {
        logger.warn('Currency conversion failed for explore products, returning USD', {
          currencyCode,
          error: conversionError.message,
        });
        finalProducts = enrichedProducts;
      }
    }

    logger.info('Explore products retrieved', {
      requestId: req.requestId,
      total,
      returned: finalProducts.length,
      page,
      limit,
      sort,
      hasUser: !!userId,
      preferredCategoriesCount: preferredCategories.length,
      currencyCode: currencyCode || 'USD',
    });

    return sendPaginated(res, {
      data: finalProducts,
      page,
      limit,
      total,
      message: 'Explore products retrieved successfully',
    });
  } catch (error) {
    logger.error('Error exploring products', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    throw error;
  }
};
