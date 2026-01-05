import Product from '../models/product.model.js'
import Merchant from '../models/merchant.model.js'
import { getAuth } from '@clerk/express'
import { clerkClient } from '@clerk/express'
import { sendSuccess, sendError, sendCreated, sendNotFound, sendPaginated, sendForbidden } from '../lib/response.js'

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
    const filter = {};
    if (category) {
      filter.category = category; // Safe: validated as MongoDB ObjectId
    }
    if (merchant) {
      filter.merchant = merchant; // Safe: validated as MongoDB ObjectId
    }

    const products = await Product.find(filter)
      .populate('merchant', 'businessName businessEmail')
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
        
        // If user is a merchant, auto-assign merchant to product
        if (userId) {
            try {
                const user = await clerkClient.users.getUser(userId);
                if (user.publicMetadata?.role === 'merchant') {
                    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });
                    if (merchant) {
                        req.body.merchant = merchant._id;
                    }
                }
            } catch (error) {
                // If merchant lookup fails, continue without auto-assignment
            }
        }
        
        const product = await Product.create(req.body)
        await product.populate('merchant', 'businessName businessEmail')
            .populate('category', 'name');
        
        return sendCreated(res, product, 'Product created successfully');
    } catch (error) {
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

