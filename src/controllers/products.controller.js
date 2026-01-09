import Product from '../models/product.model.js'
import Merchant from '../models/merchant.model.js'
import { getAuth } from '@clerk/express'
import { clerkClient } from '@clerk/express'
import { sendSuccess, sendError, sendCreated, sendNotFound, sendPaginated, sendForbidden } from '../lib/response.js'
import logger from '../lib/logger.js'

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

    // Build filter - values are already validated as MongoDB ObjectIds by middleware
    const filter = { isActive: true }; // Only return active products by default
    if (category) {
      filter.category = category; // Safe: validated as MongoDB ObjectId
    }
    if (merchant) {
      filter.merchant = merchant; // Safe: validated as MongoDB ObjectId
    }

    const products = await Product.find(filter)
      .populate('merchant', 'businessName businessEmail')
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
      message: 'Products retrieved successfully',
    });
  } catch (error) {
    // Let error handler middleware handle the response
    throw error;
  }
};


export const getProductById = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
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
            return sendError(res, {
                message: 'Unauthorized',
                statusCode: 401,
                code: 'UNAUTHORIZED',
            });
        }
        
        // Middleware (isAdminOrApprovedMerchant) already checked:
        // - User is authenticated
        // - User is either admin or approved merchant
        // - If merchant, req.merchant is set and approved
        
        // Auto-assign merchant to product if user is a merchant
        // For admins, merchant field can be null or set explicitly
        if (req.merchant) {
            // User is an approved merchant - auto-assign merchant to product
            req.body.merchant = req.merchant._id;
        }
        // For admins, req.merchant will be undefined, and merchant can be set explicitly or left null
        
        // Log received data for debugging
        logger.info('Creating product', {
            userId,
            isMerchant: !!req.merchant,
            isAdmin: !req.merchant, // If no merchant, user is admin (middleware guarantees this)
            merchantId: req.body.merchant || req.merchant?._id,
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
        
        const product = await Product.create(req.body)
        
        // Populate multiple fields - when using populate on a document (not query), need to await it
        const populatedProduct = await Product.findById(product._id)
            .populate('merchant', 'businessName businessEmail')
            .populate('category', 'name');
        
        return sendCreated(res, populatedProduct, 'Product created successfully');
    } catch (error) {
        logger.error('Error creating product', {
            error: error.message,
            errorName: error.name,
            errorStack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            body: req.body,
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
                        return sendForbidden(res, 'You can only delete your own products');
                    }
                }
            } catch (error) {
                // Continue if check fails
            }
        }
        
        await Product.findByIdAndDelete(req.params.id);
        
        return sendSuccess(res, {
            message: 'Product deleted successfully',
        });
    } catch (error) {
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
        const filter = { merchant: merchant._id };
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

