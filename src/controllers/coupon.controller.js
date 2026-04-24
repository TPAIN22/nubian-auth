import Coupon from '../models/coupon.model.js';
import CouponUsage from '../models/couponUsage.model.js';
import Order from '../models/orders.model.js';
import couponService from '../services/coupon.service.js';
import Product from '../models/product.model.js';
import { sendSuccess, sendError, sendCreated, sendNotFound } from '../lib/response.js';
import logger from '../lib/logger.js';
import { getAuth } from '@clerk/express';
import mongoose from 'mongoose';

/**
 * Get all coupons with filtering and pagination
 * GET /api/coupons
 */
export const getCoupons = async (req, res) => {
  try {
    const { 
      isActive, 
      expired, 
      merchantId,
      categoryId,
      productId,
      page = 1, 
      limit = 20 
    } = req.query;

    const query = {};

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Filter expired coupons
    if (expired === 'true') {
      query.endDate = { $lt: new Date() };
    } else if (expired === 'false') {
      query.endDate = { $gte: new Date() };
    }

    // Filter by merchant
    if (merchantId) {
      query.applicableMerchants = merchantId;
    }

    // Filter by category
    if (categoryId) {
      query.applicableCategories = categoryId;
    }

    // Filter by product
    if (productId) {
      query.applicableProducts = productId;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const coupons = await Coupon.find(query)
      .populate('applicableProducts', 'name price finalPrice')
      .populate('applicableCategories', 'name')
      .populate('applicableMerchants', 'businessName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Coupon.countDocuments(query);

    return sendSuccess(res, {
      data: coupons,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    logger.error('Error getting coupons', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    return sendError(res, {
      message: 'Failed to retrieve coupons',
      error: error.message,
    }, 500);
  }
};

/**
 * Get coupon by ID
 * GET /api/coupons/:id
 */
export const getCouponById = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id)
      .populate('applicableProducts', 'name price finalPrice merchantPrice')
      .populate('applicableCategories', 'name')
      .populate('applicableMerchants', 'businessName');

    if (!coupon) {
      return sendNotFound(res, { message: 'Coupon not found' });
    }

    return sendSuccess(res, { data: coupon });
  } catch (error) {
    logger.error('Error getting coupon by ID', {
      requestId: req.requestId,
      couponId: req.params.id,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to retrieve coupon',
      error: error.message,
    }, 500);
  }
};

/**
 * Get coupon by code (for validation)
 * GET /api/coupons/code/:code
 */
export const getCouponByCode = async (req, res) => {
  try {
    const { code } = req.params;
    const { userId, orderAmount, productIds } = req.query;

    if (!code) {
      return sendError(res, { message: 'Coupon code is required' }, 400);
    }

    const coupon = await Coupon.findOne({ 
      code: code.toUpperCase().trim(),
      isActive: true,
    })
      .populate('applicableProducts', 'name price finalPrice merchantPrice')
      .populate('applicableCategories', 'name')
      .populate('applicableMerchants', 'businessName');

    if (!coupon) {
      return sendNotFound(res, { message: 'Invalid or inactive coupon code' });
    }

    // Validate coupon
    const now = new Date();
    const validation = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // Check date validity
    if (coupon.startDate > now) {
      validation.valid = false;
      validation.errors.push('Coupon is not yet active');
    }
    if (coupon.endDate < now) {
      validation.valid = false;
      validation.errors.push('Coupon has expired');
    }

    // Check global usage limit
    if (coupon.usageLimitGlobal !== null && coupon.usageCount >= coupon.usageLimitGlobal) {
      validation.valid = false;
      validation.errors.push('Coupon usage limit reached');
    }

    // Check user usage limit
    if (userId && coupon.usageLimitPerUser > 0) {
      const userUsageCount = await CouponUsage.countDocuments({ coupon: coupon._id, user: userId });
      if (userUsageCount >= coupon.usageLimitPerUser) {
        validation.valid = false;
        validation.errors.push('You have already used this coupon the maximum allowed times');
      }
    }

    // Check minimum order amount
    if (orderAmount && coupon.minOrderAmount > 0) {
      const orderAmountNum = parseFloat(orderAmount);
      if (orderAmountNum < coupon.minOrderAmount) {
        validation.valid = false;
        validation.errors.push(`Minimum order amount of ${coupon.minOrderAmount} required`);
      }
    }

    // Check product eligibility
    if (productIds && coupon.applicableProducts.length > 0) {
      const productIdsArray = Array.isArray(productIds) ? productIds : productIds.split(',');
      const applicableProductIds = coupon.applicableProducts.map(p => p._id.toString());
      const hasEligibleProduct = productIdsArray.some(pid => applicableProductIds.includes(pid));
      
      if (!hasEligibleProduct) {
        validation.valid = false;
        validation.errors.push('Coupon is not valid for selected products');
      }
    }

    // Check category eligibility
    if (productIds && coupon.applicableCategories.length > 0) {
      const productIdsArray = Array.isArray(productIds) ? productIds : productIds.split(',');
      const products = await Product.find({ _id: { $in: productIdsArray } }).select('category');
      const productCategoryIds = products.map(p => p.category?.toString()).filter(Boolean);
      const applicableCategoryIds = coupon.applicableCategories.map(c => c._id.toString());
      const hasEligibleCategory = productCategoryIds.some(cid => applicableCategoryIds.includes(cid));
      
      if (!hasEligibleCategory) {
        validation.valid = false;
        validation.errors.push('Coupon is not valid for selected product categories');
      }
    }

    // Calculate discount preview if order amount provided
    let discountAmount = 0;
    if (validation.valid && orderAmount) {
      discountAmount = coupon.calculateDiscount(parseFloat(orderAmount));
    }

    return sendSuccess(res, {
      data: {
        coupon: {
          _id: coupon._id,
          code: coupon.code,
          type: coupon.type || coupon.discountType,
          value: coupon.value || coupon.discountValue,
          minOrderAmount: coupon.minOrderAmount,
          maxDiscount: coupon.maxDiscount,
          startDate: coupon.startDate,
          endDate: coupon.endDate || coupon.expiresAt,
          usageLimitPerUser: coupon.usageLimitPerUser,
          usageLimitGlobal: coupon.usageLimitGlobal,
          applicableProducts: coupon.applicableProducts,
          applicableCategories: coupon.applicableCategories,
          applicableMerchants: coupon.applicableMerchants,
        },
        validation,
        discountAmount,
        discountPreview: orderAmount ? {
          originalAmount: parseFloat(orderAmount),
          discountAmount,
          finalAmount: parseFloat(orderAmount) - discountAmount,
        } : null,
      },
    });
  } catch (error) {
    logger.error('Error getting coupon by code', {
      requestId: req.requestId,
      code: req.params.code,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to validate coupon',
      error: error.message,
    }, 500);
  }
};

/**
 * Create new coupon
 * POST /api/coupons
 */
export const createCoupon = async (req, res) => {
  try {
    const {
      code,
      type,
      value,
      minOrderAmount = 0,
      maxDiscount = null,
      startDate,
      endDate,
      usageLimitPerUser = 1,
      usageLimitGlobal = null,
      applicableProducts = [],
      applicableCategories = [],
      applicableMerchants = [],
      isActive = true,
    } = req.body;

    // Validate required fields
    if (!code || !type || value === undefined || !endDate) {
      return sendError(res, {
        message: 'Missing required fields: code, type, value, endDate',
      }, 400);
    }

    // Validate dates
    const start = startDate ? new Date(startDate) : new Date();
    const end = new Date(endDate);
    if (start > end) {
      return sendError(res, {
        message: 'Start date must be before or equal to end date',
      }, 400);
    }

    // Validate value
    if (value < 0) {
      return sendError(res, {
        message: 'Coupon value cannot be negative',
      }, 400);
    }

    // Validate percentage discount
    if (type === 'percentage' && value > 100) {
      return sendError(res, {
        message: 'Percentage discount cannot exceed 100%',
      }, 400);
    }

    const couponData = {
      code: code.toUpperCase().trim(),
      type,
      value,
      minOrderAmount,
      maxDiscount,
      startDate: start,
      endDate: end,
      usageLimitPerUser,
      usageLimitGlobal,
      applicableProducts,
      applicableCategories,
      applicableMerchants,
      isActive,
    };

    const coupon = await Coupon.create(couponData);

    logger.info('Coupon created', {
      requestId: req.requestId,
      couponId: coupon._id,
      code: coupon.code,
    });

    return sendCreated(res, coupon, 'Coupon created successfully');
  } catch (error) {
    logger.error('Error creating coupon', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

    if (error.code === 11000) {
      return sendError(res, {
        message: 'Coupon code already exists',
      }, 409);
    }

    return sendError(res, {
      message: 'Failed to create coupon',
      error: error.message,
    }, 500);
  }
};

/**
 * Update coupon
 * PUT /api/coupons/:id
 */
export const updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
      return sendNotFound(res, { message: 'Coupon not found' });
    }

    // Uppercase code if provided
    if (req.body.code) {
      req.body.code = req.body.code.toUpperCase().trim();
    }

    const updatedCoupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('applicableProducts', 'name price finalPrice')
      .populate('applicableCategories', 'name')
      .populate('applicableMerchants', 'businessName');

    logger.info('Coupon updated', {
      requestId: req.requestId,
      couponId: updatedCoupon._id,
    });

    return sendSuccess(res, {
      data: updatedCoupon,
      message: 'Coupon updated successfully',
    });
  } catch (error) {
    logger.error('Error updating coupon', {
      requestId: req.requestId,
      couponId: req.params.id,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to update coupon',
      error: error.message,
    }, 500);
  }
};

/**
 * Deactivate coupon
 * PATCH /api/coupons/:id/deactivate
 */
export const deactivateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!coupon) {
      return sendNotFound(res, { message: 'Coupon not found' });
    }

    logger.info('Coupon deactivated', {
      requestId: req.requestId,
      couponId: coupon._id,
      code: coupon.code,
    });

    return sendSuccess(res, {
      data: coupon,
      message: 'Coupon deactivated successfully',
    });
  } catch (error) {
    logger.error('Error deactivating coupon', {
      requestId: req.requestId,
      couponId: req.params.id,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to deactivate coupon',
      error: error.message,
    }, 500);
  }
};

/**
 * Delete coupon
 * DELETE /api/coupons/:id
 */
export const deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);

    if (!coupon) {
      return sendNotFound(res, { message: 'Coupon not found' });
    }

    logger.info('Coupon deleted', {
      requestId: req.requestId,
      couponId: req.params.id,
    });

    return sendSuccess(res, {
      message: 'Coupon deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting coupon', {
      requestId: req.requestId,
      couponId: req.params.id,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to delete coupon',
      error: error.message,
    }, 500);
  }
};

/**
 * Validate and apply coupon to order
 * POST /api/coupons/validate
 */
export const validateCoupon = async (req, res) => {
  try {
    const { code, userId, orderAmount, productIds, cartItems } = req.body;
    if (!code) return sendError(res, { message: 'Coupon code is required', statusCode: 400 });

    const orderAmountNum = orderAmount ? parseFloat(orderAmount) : 0;

    // Core validation delegated to service (date, limits, min-order)
    const result = await couponService.validateCoupon(code, userId, orderAmountNum);
    if (!result.valid) {
      return sendSuccess(res, { data: { valid: false, errors: result.errors } });
    }

    const coupon = result.coupon;
    const eligibilityErrors = [];

    // Product eligibility (UI-specific check, not part of core reservation)
    if (productIds && coupon.applicableProducts?.length > 0) {
      const pids = Array.isArray(productIds) ? productIds : productIds.split(',');
      const applicable = coupon.applicableProducts.map(p => p.toString());
      if (!pids.some(pid => applicable.includes(pid.toString()))) {
        eligibilityErrors.push('Coupon is not valid for selected products');
      }
    }

    // Category eligibility
    if (cartItems && coupon.applicableCategories?.length > 0) {
      const pids = cartItems.map(i => i.product?._id || i.productId).filter(Boolean);
      const prods = await Product.find({ _id: { $in: pids } }).select('category');
      const catIds = prods.map(p => p.category?.toString()).filter(Boolean);
      const applicable = coupon.applicableCategories.map(c => c.toString());
      if (!catIds.some(cid => applicable.includes(cid))) {
        eligibilityErrors.push('Coupon is not valid for selected product categories');
      }
    }

    if (eligibilityErrors.length > 0) {
      return sendSuccess(res, { data: { valid: false, errors: eligibilityErrors } });
    }

    return sendSuccess(res, {
      data: {
        valid: true,
        coupon: { _id: coupon._id, code: coupon.code, type: coupon.type, value: coupon.value },
        discountAmount:   result.discountAmount,
        originalAmount:   orderAmountNum,
        finalAmount:      orderAmountNum - result.discountAmount,
        message: 'Coupon is valid',
      },
    });
  } catch (error) {
    logger.error('Error validating coupon', { requestId: req.requestId, error: error.message });
    return sendError(res, { message: 'Failed to validate coupon', statusCode: 500 });
  }
};

/**
 * Get coupon usage analytics
 * GET /api/coupons/:id/analytics
 */
export const getCouponAnalytics = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
      return sendNotFound(res, { message: 'Coupon not found' });
    }

    // Get orders that used this coupon
    const orders = await Order.find({ coupon: coupon._id })
      .select('totalAmount discountAmount createdAt status')
      .sort({ createdAt: -1 });

    const analytics = {
      coupon: {
        _id: coupon._id,
        code: coupon.code,
        type: coupon.type || coupon.discountType,
        value: coupon.value || coupon.discountValue,
      },
      usage: {
        totalUses: coupon.usageCount || 0,
        uniqueUsers: await CouponUsage.distinct('user', { coupon: coupon._id }).then(r => r.length),
        totalDiscountGiven: coupon.totalDiscountGiven || 0,
        totalOrders: coupon.totalOrders || orders.length,
      },
      orders: orders.map(order => ({
        orderId: order._id,
        totalAmount: order.totalAmount,
        discountAmount: order.discountAmount,
        createdAt: order.createdAt,
        status: order.status,
      })),
      period: {
        startDate: coupon.startDate,
        endDate: coupon.endDate || coupon.expiresAt,
        isActive: coupon.isActive,
        isExpired: coupon.endDate < new Date(),
      },
    };

    return sendSuccess(res, { data: analytics });
  } catch (error) {
    logger.error('Error getting coupon analytics', {
      requestId: req.requestId,
      couponId: req.params.id,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to retrieve coupon analytics',
      error: error.message,
    }, 500);
  }
};

/**
 * Get available coupons for user (recommendations)
 * GET /api/coupons/available
 */
export const getAvailableCoupons = async (req, res) => {
  try {
    const { userId, orderAmount, productIds, categoryIds, merchantIds } = req.query;
    const { userId: authUserId } = getAuth(req);

    const query = {
      isActive: true,
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() },
    };

    // Filter by global usage limit
    query.$or = [
      { usageLimitGlobal: null },
      { $expr: { $lt: ['$usageCount', '$usageLimitGlobal'] } },
    ];

    // Filter by product eligibility
    if (productIds) {
      const productIdsArray = Array.isArray(productIds) ? productIds : productIds.split(',');
      query.$or.push(
        { applicableProducts: { $in: productIdsArray } },
        { applicableProducts: { $size: 0 } }
      );
    }

    // Filter by category eligibility
    if (categoryIds) {
      const categoryIdsArray = Array.isArray(categoryIds) ? categoryIds : categoryIds.split(',');
      query.$or.push(
        { applicableCategories: { $in: categoryIdsArray } },
        { applicableCategories: { $size: 0 } }
      );
    }

    // Filter by merchant eligibility
    if (merchantIds) {
      const merchantIdsArray = Array.isArray(merchantIds) ? merchantIds : merchantIds.split(',');
      query.$or.push(
        { applicableMerchants: { $in: merchantIdsArray } },
        { applicableMerchants: { $size: 0 } }
      );
    }

    const coupons = await Coupon.find(query)
      .populate('applicableProducts', 'name price finalPrice')
      .populate('applicableCategories', 'name')
      .populate('applicableMerchants', 'businessName')
      .sort({ createdAt: -1 })
      .limit(10);

    // Pre-fetch per-user usage counts in one batch query rather than per-coupon array scans
    const couponIds = coupons.map(c => c._id);
    const usageCounts = userId
      ? await CouponUsage.aggregate([
          { $match: { coupon: { $in: couponIds }, user: mongoose.Types.ObjectId.createFromHexString(userId.toString()) } },
          { $group: { _id: '$coupon', count: { $sum: 1 } } },
        ])
      : [];
    const usageMap = new Map(usageCounts.map(r => [r._id.toString(), r.count]));

    const availableCoupons = coupons.filter(coupon => {
      if (userId && coupon.usageLimitPerUser > 0) {
        const userUsageCount = usageMap.get(coupon._id.toString()) || 0;
        if (userUsageCount >= coupon.usageLimitPerUser) return false;
      }
      if (orderAmount && coupon.minOrderAmount > 0) {
        if (parseFloat(orderAmount) < coupon.minOrderAmount) return false;
      }
      return true;
    });

    // Calculate discount preview for each coupon
    const couponsWithPreview = availableCoupons.map(coupon => {
      const discountAmount = orderAmount ? coupon.calculateDiscount(parseFloat(orderAmount)) : 0;
      return {
        ...coupon.toObject(),
        discountPreview: orderAmount ? {
          originalAmount: parseFloat(orderAmount),
          discountAmount,
          finalAmount: parseFloat(orderAmount) - discountAmount,
        } : null,
      };
    });

    return sendSuccess(res, {
      data: couponsWithPreview,
      message: 'Available coupons retrieved successfully',
    });
  } catch (error) {
    logger.error('Error getting available coupons', {
      requestId: req.requestId,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to retrieve available coupons',
      error: error.message,
    }, 500);
  }
};
