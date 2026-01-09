import mongoose from 'mongoose'
import Product from '../models/product.model.js'
import Merchant from '../models/merchant.model.js'
import { getAuth } from '@clerk/express'
import { clerkClient } from '@clerk/express'
import { sendSuccess, sendError, sendCreated, sendNotFound, sendPaginated, sendForbidden } from '../lib/response.js'
import logger from '../lib/logger.js'
import { getUserPreferredCategories, RANKING_CONSTANTS } from '../utils/productRanking.js'

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

    // Get user preferred categories for personalization (optional, safe fallback)
    const preferredCategories = getUserPreferredCategories(req);

    // Build filter - values are already validated as MongoDB ObjectIds by middleware
    const filter = { 
      isActive: true, // Only return active products by default
      deletedAt: null, // Exclude soft-deleted products
    };
    if (category) {
      filter.category = category; // Safe: validated as MongoDB ObjectId
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

    // Skip and limit for pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    // Execute aggregation
    const products = await Product.aggregate(pipeline);

    // Get total count for pagination
    const totalProducts = await Product.countDocuments(filter);

    // Populate referenced fields (merchant, category)
    // Note: Aggregation doesn't populate, so we need to manually populate
    const populatedProducts = await Product.populate(products, [
      { path: 'merchant', select: 'businessName businessEmail' },
      { path: 'category', select: 'name' }
    ]);

    logger.debug('Products retrieved with ranking', {
      requestId: req.requestId,
      total: totalProducts,
      returned: populatedProducts.length,
      page,
      limit,
      hasPersonalization: preferredCategories.length > 0,
    });

    return sendPaginated(res, {
      data: populatedProducts,
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
        
        return sendSuccess(res, {
            data: product,
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
        
        logger.debug('Attempting to create product in database', {
            requestId: req.requestId,
            userId,
            productName: req.body.name,
            categoryId: req.body.category,
            merchantId: req.body.merchant || null,
        });

        const product = await Product.create(req.body)
        
        logger.info('Product created successfully in database', {
            requestId: req.requestId,
            userId,
            productId: product._id,
            productName: product.name,
            userRole,
            merchantId: product.merchant || null,
        });
        
        // Populate multiple fields - when using populate on a document (not query), need to await it
        const populatedProduct = await Product.findById(product._id)
            .populate('merchant', 'businessName businessEmail')
            .populate('category', 'name');
        
        return sendCreated(res, populatedProduct, 'Product created successfully');
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
        
        const updatedProduct = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
            .populate('merchant', 'businessName businessEmail')
            .populate('category', 'name');
        
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
        const { userId } = getAuth(req);
        const product = await Product.findOne({
            _id: req.params.id,
            deletedAt: null, // Only find non-deleted products
        });
        
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
                        return sendForbidden(res, 'You can only delete your own products');
                    }
                }
            } catch (error) {
                // Continue if check fails
            }
        }
        
        // Soft delete: Set deletedAt timestamp instead of hard delete
        // This preserves data integrity for existing orders and allows recovery
        product.deletedAt = new Date();
        await product.save();
        
        logger.info('Product soft deleted', {
            requestId: req.requestId,
            productId: product._id,
            userId: userId,
        });
        
        return sendSuccess(res, {
            message: 'Product deleted successfully',
        });
    } catch (error) {
        logger.error('Error deleting product', {
            requestId: req.requestId,
            productId: req.params.id,
            error: error.message,
        });
        // Let error handler middleware handle the response
        throw error;
    }
}

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
        
        return sendPaginated(res, {
            data: products,
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

        logger.info('Admin retrieved all products', {
            requestId: req.requestId,
            userId: getAuth(req).userId,
            total: totalProducts,
            page,
            limit,
            filters: { category, merchant, isActive, includeDeleted, search },
        });

        return sendPaginated(res, {
            data: products,
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
