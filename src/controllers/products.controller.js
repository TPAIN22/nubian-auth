import mongoose from 'mongoose'
import Product from '../models/product.model.js'
import Merchant from '../models/merchant.model.js'
import User from '../models/user.model.js'
import Category from '../models/categories.model.js'
import { getAuth } from '@clerk/express'
import { clerkClient } from '@clerk/express'
import { sendSuccess, sendError, sendCreated, sendNotFound, sendPaginated, sendForbidden } from '../lib/response.js'
import logger from '../lib/logger.js'
import { getUserPreferredCategories, RANKING_CONSTANTS } from '../utils/productRanking.js'
import { convertProductPrices } from '../services/currency.service.js'

/**
 * Enrich product with pricing breakdown for API responses
 * Adds finalPrice, merchantPrice, and pricingBreakdown to product objects
 */function enrichProductWithPricing(product) {
  if (!product) return product;

  const p = product.toObject ? product.toObject() : product;
  const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;

  // helper
  const num = (v, fb = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };

  // normalize + fallback without recalculating dynamic pricing
  const normalizePriceBlock = (obj) => {
    const merchantPrice = num(obj.merchantPrice ?? obj.price ?? 0);
    const discountPrice = num(obj.discountPrice ?? 0);
    const finalPriceRaw = num(obj.finalPrice ?? 0);

    const finalPrice =
      finalPriceRaw > 0
        ? finalPriceRaw
        : discountPrice > 0
          ? discountPrice
          : merchantPrice;

    return { merchantPrice, price: num(obj.price ?? merchantPrice), discountPrice, finalPrice };
  };

  if (hasVariants) {
    const variants = p.variants.map((v) => {
      const prices = normalizePriceBlock(v);
      return { ...v, ...prices };
    });

    // root finalPrice fallback = lowest active variant finalPrice (for UI "From" price)
    const activeVariants = variants.filter((v) => v.isActive !== false);
    
    // Find the "representative" variant (the one with the lowest final price)
    // We use this variant's properties for the "From" display to ensuring consistency
    let bestVariant = null;
    let minFinal = Infinity;

    // specific logic to find best variant
    if (activeVariants.length > 0) {
        activeVariants.forEach(v => {
            const fp = num(v.finalPrice, 0);
            if (fp > 0 && fp < minFinal) {
                minFinal = fp;
                bestVariant = v;
            }
        });
    }

    // Default to first variant if no best found (rare)
    if (!bestVariant && variants.length > 0) {
        bestVariant = variants[0];
    }

    const rootPrices = normalizePriceBlock(p);
    
    // For variant products, root prices represent "From" price of the BEST variant
    const rootFinal = bestVariant ? num(bestVariant.finalPrice, 0) : rootPrices.finalPrice;
    const rootMerchant = bestVariant ? num(bestVariant.merchantPrice, 0) : rootPrices.merchantPrice;
    // Use the markup of the representative variant, or fallback to product default
    const rootMarkup = bestVariant ? num(bestVariant.nubianMarkup ?? p.nubianMarkup ?? 10) : num(p.nubianMarkup ?? 10);

    // Calculate discount for display using CONSISTENT values from the same variant
    // FIX: Use merchantPrice + nubianMarkup (MSRP) as the basis for discount
    const originalPrice = rootMerchant > 0 ? (rootMerchant * (1 + rootMarkup / 100)) : 0;

    let discountPercentage = 0;
    if (originalPrice > 0 && rootFinal < originalPrice) {
        // Ensure we don't show tiny discounts due to rounding (e.g. < 1%) unless it's real
        const rawPct = ((originalPrice - rootFinal) / originalPrice) * 100;
        discountPercentage = Math.round(rawPct);
    }

    return {
      ...p,
      merchantPrice: rootMerchant,
      price: rootMerchant,
      // Pass the specific markup used so frontend can replicate calculation if needed
      nubianMarkup: rootMarkup, 
      discountPrice: rootPrices.discountPrice,
      finalPrice: rootFinal,
      discountPercentage,
      variants,
    };
  }

  // simple product
  const rootPrices = normalizePriceBlock(p);
  
  // Calculate discount percentage
  let discountPercentage = 0;
  // FIX: Use merchantPrice + nubianMarkup (MSRP) as the basis for discount, not just merchantPrice
  const markup = num(p.nubianMarkup ?? 10);
  const originalPrice = rootPrices.merchantPrice > 0 ? (rootPrices.merchantPrice * (1 + markup / 100)) : 0;
  
  if (originalPrice > 0 && rootPrices.finalPrice < originalPrice) {
      discountPercentage = Math.round(((originalPrice - rootPrices.finalPrice) / originalPrice) * 100);
  }

  return { 
      ...p, 
      ...rootPrices,
      discountPercentage 
  };
}


/**
 * Enrich array of products with pricing breakdown
 */
function enrichProductsWithPricing(products) {
  if (!Array.isArray(products)) return products;
  return products.map(enrichProductWithPricing);
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
      isActive: true, // Only return active products by default
      deletedAt: null, // Exclude soft-deleted products
    };
    
    // Handle hierarchical categories: if category has children, include all subcategories
    if (category) {
      try {
        const categoryId = new mongoose.Types.ObjectId(category);
        
        // Find all subcategories (children) of this category
        const subcategories = await Category.find({ 
          parent: categoryId,
          isActive: true 
        }).select('_id').lean();
        
        // Build array of category IDs: parent + all children
        const categoryIds = [categoryId];
        if (subcategories && subcategories.length > 0) {
          subcategories.forEach(sub => {
            if (sub._id) {
              categoryIds.push(sub._id);
            }
          });
        }
        
        // Use $in to match products in parent category OR any subcategory
        filter.category = { $in: categoryIds };
        
        logger.info('Category filter with subcategories', {
          categoryId: category,
          subcategoryCount: subcategories.length,
          totalCategoryIds: categoryIds.length,
        });
      } catch (e) {
        // Invalid ObjectId, fallback to direct match
        logger.warn('Invalid category ID, using direct match', { category, error: e.message });
        filter.category = category;
      }
    }
    
    if (merchant) {
      filter.merchant = merchant; // Safe: validated as MongoDB ObjectId
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
          
          // Stock boost (products with good stock)
          stockValue: { $ifNull: ['$stock', 0] },
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
    pipeline.push({
      $lookup: {
        from: 'merchants',
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
              businessName: { $arrayElemAt: ['$merchantData.businessName', 0] },
              businessEmail: { $arrayElemAt: ['$merchantData.businessEmail', 0] }
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
            .populate('merchant', 'businessName businessEmail')
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
export const createProduct = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        
        if (!userId) {
            logger.warn('Product creation failed: No userId', {
                requestId: req.requestId,
                hasAuth: !!req.auth,
            });
            return sendError(res, {
                message: 'Unauthorized',
                statusCode: 401,
                code: 'UNAUTHORIZED',
            });
        }
        
        // Verify user role to ensure middleware passed correctly
        let userRole = null;
        try {
            const user = await clerkClient.users.getUser(userId);
            userRole = user.publicMetadata?.role;
            logger.debug('User role verified for product creation', {
                requestId: req.requestId,
                userId,
                userRole,
                hasMerchant: !!req.merchant,
            });
        } catch (clerkError) {
            logger.error('Failed to verify user role in createProduct', {
                requestId: req.requestId,
                userId,
                error: clerkError.message,
            });
            return sendError(res, {
                message: 'Failed to verify user permissions',
                statusCode: 500,
                code: 'CLERK_ERROR',
            });
        }
        
        // Middleware (isAdminOrApprovedMerchant) already checked:
        // - User is authenticated
        // - User is either admin or approved merchant
        // - If merchant, req.merchant is set and approved
        
        // Verify admin or merchant access
        if (userRole !== 'admin' && userRole !== 'merchant') {
            logger.warn('Unauthorized product creation attempt', {
                requestId: req.requestId,
                userId,
                userRole,
            });
            return sendError(res, {
                message: 'Only admins and approved merchants can create products',
                statusCode: 403,
                code: 'FORBIDDEN',
            });
        }
        
        // Auto-assign merchant to product if user is a merchant
        // For admins, merchant field can be null or set explicitly
        if (req.merchant) {
            // User is an approved merchant - auto-assign merchant to product
            req.body.merchant = req.merchant._id;
            logger.debug('Auto-assigning merchant to product', {
                requestId: req.requestId,
                merchantId: req.merchant._id,
            });
        } else if (userRole === 'admin') {
            // Admin can set merchant explicitly or leave null for general products
            logger.debug('Admin creating product - merchant can be set explicitly or left null', {
                requestId: req.requestId,
                providedMerchantId: req.body.merchant,
            });
        }
        
        // Log received data for debugging
        logger.info('Creating product', {
            requestId: req.requestId,
            userId,
            userRole,
            isMerchant: !!req.merchant,
            isAdmin: userRole === 'admin',
            merchantId: req.body.merchant || req.merchant?._id || null,
            hasCategory: !!req.body.category,
            hasImages: Array.isArray(req.body.images),
            imagesCount: Array.isArray(req.body.images) ? req.body.images.length : 0,
        });
        
        // Validate required fields match schema
        if (!req.body.category) {
            return sendError(res, {
                message: 'Category is required',
                statusCode: 400,
                code: 'VALIDATION_ERROR',
            });
        }
        
        if (!req.body.images || !Array.isArray(req.body.images) || req.body.images.length === 0) {
            return sendError(res, {
                message: 'At least one image is required',
                statusCode: 400,
                code: 'VALIDATION_ERROR',
            });
        }
        
        // Validate variants if provided
        if (req.body.variants && Array.isArray(req.body.variants) && req.body.variants.length > 0) {
            // Check SKU uniqueness within the product
            const skus = new Set();
            for (const variant of req.body.variants) {
                const sku = variant.sku?.trim().toUpperCase();
                if (!sku) {
                    return sendError(res, {
                        message: 'All variants must have a SKU',
                        statusCode: 400,
                        code: 'VALIDATION_ERROR',
                    });
                }
                if (skus.has(sku)) {
                    return sendError(res, {
                        message: `Duplicate SKU found: ${variant.sku}`,
                        statusCode: 400,
                        code: 'VALIDATION_ERROR',
                    });
                }
                skus.add(sku);
                
                // Convert attributes object to Map for MongoDB
                if (variant.attributes && typeof variant.attributes === 'object' && !(variant.attributes instanceof Map)) {
                    variant.attributes = new Map(Object.entries(variant.attributes));
                }
            }
        }
        
        // Ensure category is a valid MongoDB ObjectId
        let categoryId = req.body.category;
        if (categoryId && typeof categoryId === 'string') {
            categoryId = categoryId.trim();
            // Validate it's a valid MongoDB ObjectId format
            if (!mongoose.Types.ObjectId.isValid(categoryId)) {
                logger.error('Invalid category ID format', {
                    requestId: req.requestId,
                    userId,
                    categoryId,
                    categoryType: typeof categoryId,
                });
                return sendError(res, {
                    message: 'Invalid category ID format',
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                });
            }
            // Convert to ObjectId
            req.body.category = new mongoose.Types.ObjectId(categoryId);
        }

        // ===== SMART PRICING: Sync price with merchantPrice =====
        // If price is provided but merchantPrice is not, set merchantPrice = price
        // This ensures backward compatibility and proper pricing calculation
        if (req.body.price && !req.body.merchantPrice) {
            req.body.merchantPrice = req.body.price;
            logger.debug('Syncing merchantPrice with price', {
                requestId: req.requestId,
                price: req.body.price,
                merchantPrice: req.body.merchantPrice,
            });
        }
        // If merchantPrice is provided but price is not, set price = merchantPrice
        if (req.body.merchantPrice && !req.body.price) {
            req.body.price = req.body.merchantPrice;
        }
        // Set default nubianMarkup if not provided
        if (!req.body.nubianMarkup && req.body.nubianMarkup !== 0) {
            req.body.nubianMarkup = 10; // Default 10%
        }
        // Initialize dynamicMarkup to 0 if not provided (will be calculated by cron)
        if (!req.body.dynamicMarkup && req.body.dynamicMarkup !== 0) {
            req.body.dynamicMarkup = 0;
        }
        
        // Handle variants pricing
        if (req.body.variants && Array.isArray(req.body.variants)) {
            req.body.variants.forEach(variant => {
                // Sync variant price with merchantPrice
                if (variant.price && !variant.merchantPrice) {
                    variant.merchantPrice = variant.price;
                }
                if (variant.merchantPrice && !variant.price) {
                    variant.price = variant.merchantPrice;
                }
                // Set default nubianMarkup for variant
                if (!variant.nubianMarkup && variant.nubianMarkup !== 0) {
                    variant.nubianMarkup = req.body.nubianMarkup || 10;
                }
                // Initialize dynamicMarkup for variant
                if (!variant.dynamicMarkup && variant.dynamicMarkup !== 0) {
                    variant.dynamicMarkup = 0;
                }
            });
        }

        // Ensure merchant is a valid MongoDB ObjectId if provided
        if (req.body.merchant && typeof req.body.merchant === 'string') {
            const merchantId = req.body.merchant.trim();
            if (mongoose.Types.ObjectId.isValid(merchantId)) {
                req.body.merchant = new mongoose.Types.ObjectId(merchantId);
            } else {
                logger.error('Invalid merchant ID format', {
                    requestId: req.requestId,
                    userId,
                    merchantId,
                });
                return sendError(res, {
                    message: 'Invalid merchant ID format',
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                });
            }
        }

        logger.info('Attempting to create product in database', {
            requestId: req.requestId,
            userId,
            productName: req.body.name,
            categoryId: req.body.category?.toString(),
            categoryIsObjectId: req.body.category instanceof mongoose.Types.ObjectId,
            merchantId: req.body.merchant?.toString() || null,
            merchantIsObjectId: req.body.merchant instanceof mongoose.Types.ObjectId,
        });

        const product = await Product.create(req.body)
        
        logger.info('Product created successfully in database', {
            requestId: req.requestId,
            userId,
            productId: product._id,
            productName: product.name,
            userRole,
            categoryId: product.category?.toString() || 'MISSING',
            categoryType: product.category ? typeof product.category : 'null',
            categoryIsObjectId: product.category instanceof mongoose.Types.ObjectId,
            merchantId: product.merchant?.toString() || null,
            merchantIsObjectId: product.merchant instanceof mongoose.Types.ObjectId,
        });
        
        // Populate multiple fields - when using populate on a document (not query), need to await it
        const populatedProduct = await Product.findById(product._id)
            .populate('merchant', 'businessName businessEmail')
            .populate('category', 'name');
        
        // Enrich product with pricing breakdown
        const enrichedProduct = enrichProductWithPricing(populatedProduct);
        
        return sendCreated(res, enrichedProduct, 'Product created successfully');
    } catch (error) {
        logger.error('Error creating product', {
            requestId: req.requestId,
            userId,
            error: error.message,
            errorName: error.name,
            errorCode: error.code,
            errorStack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            body: {
                name: req.body.name,
                category: req.body.category,
                merchant: req.body.merchant,
                hasImages: Array.isArray(req.body.images),
                imagesCount: Array.isArray(req.body.images) ? req.body.images.length : 0,
            },
        });
        // Let error handler middleware handle the response
        throw error;
    }
}
export const updateProduct = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        const product = await Product.findById(req.params.id);
        
        if (!product) {
            return sendNotFound(res, 'Product');
        }
        
        // Check if user is merchant and owns this product
        if (userId) {
            try {
                const user = await clerkClient.users.getUser(userId);
                if (user.publicMetadata?.role === 'merchant') {
                    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });
                    if (merchant && product.merchant?.toString() !== merchant._id.toString()) {
                        return sendForbidden(res, 'You can only update your own products');
                    }
                }
            } catch (error) {
                // Continue if check fails
            }
        }
        
        // Ensure category is a valid MongoDB ObjectId if provided
        if (req.body.category !== undefined) {
            let categoryId = req.body.category;
            if (categoryId && typeof categoryId === 'string') {
                categoryId = categoryId.trim();
                // Validate it's a valid MongoDB ObjectId format
                if (!mongoose.Types.ObjectId.isValid(categoryId)) {
                    logger.error('Invalid category ID format in update', {
                        requestId: req.requestId,
                        userId,
                        productId: req.params.id,
                        categoryId,
                        categoryType: typeof categoryId,
                    });
                    return sendError(res, {
                        message: 'Invalid category ID format',
                        statusCode: 400,
                        code: 'VALIDATION_ERROR',
                    });
                }
                // Convert to ObjectId
                req.body.category = new mongoose.Types.ObjectId(categoryId);
            }
        }

        // Ensure merchant is a valid MongoDB ObjectId if provided
        if (req.body.merchant !== undefined && req.body.merchant && typeof req.body.merchant === 'string') {
            const merchantId = req.body.merchant.trim();
            if (mongoose.Types.ObjectId.isValid(merchantId)) {
                req.body.merchant = new mongoose.Types.ObjectId(merchantId);
            } else {
                logger.error('Invalid merchant ID format in update', {
                    requestId: req.requestId,
                    userId,
                    productId: req.params.id,
                    merchantId,
                });
                return sendError(res, {
                    message: 'Invalid merchant ID format',
                    statusCode: 400,
                    code: 'VALIDATION_ERROR',
                });
            }
        }

        // Validate variants if provided in update
        if (req.body.variants && Array.isArray(req.body.variants) && req.body.variants.length > 0) {
            // Check SKU uniqueness within the product
            const skus = new Set();
            for (const variant of req.body.variants) {
                const sku = variant.sku?.trim().toUpperCase();
                if (!sku) {
                    return sendError(res, {
                        message: 'All variants must have a SKU',
                        statusCode: 400,
                        code: 'VALIDATION_ERROR',
                    });
                }
                if (skus.has(sku)) {
                    return sendError(res, {
                        message: `Duplicate SKU found: ${variant.sku}`,
                        statusCode: 400,
                        code: 'VALIDATION_ERROR',
                    });
                }
                skus.add(sku);
                
                // Convert attributes object to Map for MongoDB
                if (variant.attributes && typeof variant.attributes === 'object' && !(variant.attributes instanceof Map)) {
                    variant.attributes = new Map(Object.entries(variant.attributes));
                }
            }
        }

        logger.info('Updating product', {
            requestId: req.requestId,
            userId,
            productId: req.params.id,
            categoryId: req.body.category?.toString() || 'not provided',
            categoryIsObjectId: req.body.category instanceof mongoose.Types.ObjectId,
            merchantId: req.body.merchant?.toString() || 'not provided',
        });
        
        // ===== SMART PRICING: Sync price with merchantPrice =====
        // If price is provided but merchantPrice is not, set merchantPrice = price
        if (req.body.price !== undefined && req.body.merchantPrice === undefined) {
            req.body.merchantPrice = req.body.price;
        }
        // If merchantPrice is provided but price is not, set price = merchantPrice
        if (req.body.merchantPrice !== undefined && req.body.price === undefined) {
            req.body.price = req.body.merchantPrice;
        }
        // Handle variants pricing
        if (req.body.variants && Array.isArray(req.body.variants)) {
            req.body.variants.forEach(variant => {
                // Sync variant price with merchantPrice
                if (variant.price !== undefined && variant.merchantPrice === undefined) {
                    variant.merchantPrice = variant.price;
                }
                if (variant.merchantPrice !== undefined && variant.price === undefined) {
                    variant.price = variant.merchantPrice;
                }
            });
        }
        
        // Apply updates to the document
        // This triggers the Mongoose 'save' middleware which recalculates smart pricing
        product.set(req.body);
        
        // Explicitly mark variants as modified if they were updated, to ensure pre-save hooks run on them
        if (req.body.variants) {
            product.markModified('variants');
        }

        const updatedProduct = await product.save();

        // Re-populate for response
        await updatedProduct.populate('merchant', 'businessName businessEmail');
        await updatedProduct.populate('category', 'name');
        
        return sendSuccess(res, {
            data: updatedProduct,
            message: 'Product updated successfully',
        });
    } catch (error) {
        // Let error handler middleware handle the response
        throw error;
    }
}
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
          const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });
          if (merchant && product.merchant?.toString() !== merchant._id.toString()) {
            return sendForbidden(res, 'You can only delete your own products');
          }
        }
      } catch (error) {
        // لو فشل التحقق من Clerk ما نوقف (زي سلوكك الحالي)
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
        
        const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });
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
            filter.category = category; // Safe: validated as MongoDB ObjectId
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
            filter.category = category;
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
            .populate('merchant', 'businessName businessEmail status')
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

        const product = await Product.findOne({
            _id: id,
            deletedAt: null, // Only allow toggling non-deleted products
        })
            .populate('merchant', 'businessName businessEmail');

        if (!product) {
            return sendNotFound(res, 'Product');
        }

        product.isActive = isActive;
        await product.save();

        logger.info('Product active status toggled by admin', {
            requestId: req.requestId,
            userId: userId,
            productId: product._id,
            isActive: product.isActive,
            merchantId: product.merchant?._id,
        });

        // Populate for response
        const populatedProduct = await Product.findById(product._id)
            .populate('merchant', 'businessName businessEmail')
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

        product.deletedAt = null;
        await product.save();

        logger.info('Product restored by admin', {
            requestId: req.requestId,
            userId: userId,
            productId: product._id,
        });

        const populatedProduct = await Product.findById(product._id)
            .populate('merchant', 'businessName businessEmail')
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

        const product = await Product.findOne({
            _id: id,
            deletedAt: null, // Only allow updating non-deleted products
        });

        if (!product) {
            return sendNotFound(res, 'Product');
        }

        // Update ranking fields
        if (priorityScore !== undefined) {
            product.priorityScore = priorityScore;
        }
        if (featured !== undefined) {
            product.featured = featured;
        }

        await product.save();

        logger.info('Product ranking updated by admin', {
            requestId: req.requestId,
            userId: userId,
            productId: product._id,
            priorityScore: product.priorityScore,
            featured: product.featured,
        });

        // Populate for response
        const populatedProduct = await Product.findById(product._id)
            .populate('merchant', 'businessName businessEmail')
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
      isActive: true,
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

    // Category filter - handle hierarchical categories
    if (category) {
      try {
        const categoryId = new mongoose.Types.ObjectId(category);
        
        // Find all subcategories (children) of this category
        const subcategories = await Category.find({ 
          parent: categoryId,
          isActive: true 
        }).select('_id').lean();
        
        // Build array of category IDs: parent + all children
        const categoryIds = [categoryId];
        if (subcategories && subcategories.length > 0) {
          subcategories.forEach(sub => {
            if (sub._id) {
              categoryIds.push(sub._id);
            }
          });
        }
        
        // Use $in to match products in parent category OR any subcategory
        filter.category = { $in: categoryIds };
        
        logger.info('Explore category filter with subcategories', {
          categoryId: category,
          subcategoryCount: subcategories.length,
          totalCategoryIds: categoryIds.length,
        });
      } catch (e) {
        // Invalid ObjectId, skip filter
        logger.warn('Invalid category ID in explore, skipping filter', { category, error: e.message });
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
        const user = await User.findOne({ clerkId: userId })
          .populate('viewedProducts.product', 'category')
          .populate('clickedProducts.product', 'category')
          .lean();

        if (user) {
          // Extract preferred categories
          const categoryIds = new Set();
          user.viewedProducts?.forEach(vp => {
            if (vp.product?._id) {
              viewedProductIds.push(vp.product._id.toString());
            }
            if (vp.product?.category) {
              categoryIds.add(vp.product.category.toString());
            }
          });
          user.clickedProducts?.forEach(cp => {
            if (cp.product?._id) {
              clickedProductIds.push(cp.product._id.toString());
            }
            if (cp.product?.category) {
              categoryIds.add(cp.product.category.toString());
            }
          });
          preferredCategories = Array.from(categoryIds);
        }
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
      // Match base filter
      { $match: filter },

      // Lookup merchant for verified store filter
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

      // Filter by verified store
      ...(verifiedStore === 'true' ? [{ $match: { 'merchant.status': 'APPROVED' } }] : 
          verifiedStore === 'false' ? [{ $match: { 'merchant.status': { $ne: 'APPROVED' } } }] :
          []),

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

          // Trending boost (visibilityScore)
          trendingBoost: { $ifNull: ['$visibilityScore', 0] },

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

    // Execute aggregation
    const products = await Product.aggregate(pipeline);

    // Get total count (for pagination)
    const countPipeline = [
      { $match: filter },
      {
        $lookup: {
          from: 'merchants',
          localField: 'merchant',
          foreignField: '_id',
          as: 'merchant',
        },
      },
      { $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true } },
      ...(verifiedStore === 'true' ? [{ $match: { 'merchant.status': 'APPROVED' } }] : 
          verifiedStore === 'false' ? [{ $match: { 'merchant.status': { $ne: 'APPROVED' } } }] :
          []),
      { $count: 'total' },
    ];
    const countResult = await Product.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Enrich products with pricing breakdown
    const enrichedProducts = enrichProductsWithPricing(products);

    // Apply currency conversion if currencyCode is provided
    const currencyCode = req.query.currencyCode || req.query.currency;
    let finalProducts = enrichedProducts;
    
    if (currencyCode && currencyCode.toUpperCase() !== 'USD') {
      try {
        finalProducts = await Promise.all(
          enrichedProducts.map(product => convertProductPrices(product, currencyCode))
        );
        logger.debug('Applied currency conversion to explore products', {
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
