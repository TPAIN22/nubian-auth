// controllers/pricingAnalytics.controller.js
import { getAuth } from '@clerk/express';
import { clerkClient } from '@clerk/express';
import { sendSuccess, sendError, sendForbidden } from '../lib/response.js';
import logger from '../lib/logger.js';
import Product from '../models/product.model.js';
import Order from '../models/orders.model.js';
import mongoose from 'mongoose';

/**
 * Get pricing analytics for admin dashboard
 * GET /api/analytics/pricing
 * Requires admin role
 */
export const getPricingAnalytics = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        statusCode: 401,
        code: 'UNAUTHORIZED',
      });
    }

    // Verify admin role
    const user = await clerkClient.users.getUser(userId);
    const userRole = user.publicMetadata?.role;
    
    if (userRole !== 'admin') {
      return sendForbidden(res, 'Only admins can access pricing analytics');
    }

    // Get all products with pricing data
    const products = await Product.find({
      deletedAt: null,
      isActive: true,
    }).select('merchantPrice nubianMarkup dynamicMarkup finalPrice price discountPrice').lean();

    // Calculate revenue from markup
    const totalRevenueFromMarkup = products.reduce((sum, product) => {
      const merchantPrice = product.merchantPrice || product.price || 0;
      const finalPrice = product.finalPrice || product.discountPrice || product.price || 0;
      const markupRevenue = finalPrice - merchantPrice;
      return sum + Math.max(0, markupRevenue);
    }, 0);

    // Calculate average markup percentage
    const productsWithMarkup = products.filter(p => {
      const merchantPrice = p.merchantPrice || p.price || 0;
      return merchantPrice > 0;
    });

    const averageNubianMarkup = productsWithMarkup.length > 0
      ? productsWithMarkup.reduce((sum, p) => sum + (p.nubianMarkup || 10), 0) / productsWithMarkup.length
      : 10;

    const averageDynamicMarkup = productsWithMarkup.length > 0
      ? productsWithMarkup.reduce((sum, p) => sum + (p.dynamicMarkup || 0), 0) / productsWithMarkup.length
      : 0;

    // Get orders with pricing breakdown
    const orders = await Order.find({
      status: { $in: ['confirmed', 'shipped', 'delivered'] },
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
    }).select('products totalAmount finalAmount createdAt').lean();

    // Calculate revenue from orders
    let totalOrderRevenue = 0;
    let totalMerchantRevenue = 0;
    let totalMarkupRevenue = 0;

    orders.forEach(order => {
      totalOrderRevenue += order.finalAmount || order.totalAmount || 0;
      
      // Calculate markup revenue from order products
      if (order.products && Array.isArray(order.products)) {
        order.products.forEach(item => {
          const itemPrice = item.price || 0;
          const merchantPrice = item.merchantPrice || item.price || 0;
          const markupRevenue = (itemPrice - merchantPrice) * (item.quantity || 1);
          totalMarkupRevenue += Math.max(0, markupRevenue);
          totalMerchantRevenue += merchantPrice * (item.quantity || 1);
        });
      }
    });

    // Product performance metrics
    const productsWithHighMarkup = products.filter(p => {
      const dynamicMarkup = p.dynamicMarkup || 0;
      return dynamicMarkup > 20; // High dynamic markup (>20%)
    });

    const productsWithLowStock = products.filter(p => {
      const stock = p.stock || 0;
      return stock > 0 && stock <= 10;
    });

    // Pricing distribution
    const pricingDistribution = {
      low: products.filter(p => {
        const finalPrice = p.finalPrice || p.discountPrice || p.price || 0;
        return finalPrice > 0 && finalPrice < 100;
      }).length,
      medium: products.filter(p => {
        const finalPrice = p.finalPrice || p.discountPrice || p.price || 0;
        return finalPrice >= 100 && finalPrice < 500;
      }).length,
      high: products.filter(p => {
        const finalPrice = p.finalPrice || p.discountPrice || p.price || 0;
        return finalPrice >= 500;
      }).length,
    };

    return sendSuccess(res, {
      data: {
        summary: {
          totalProducts: products.length,
          totalRevenueFromMarkup: Math.round(totalMarkupRevenue * 100) / 100,
          averageNubianMarkup: Math.round(averageNubianMarkup * 100) / 100,
          averageDynamicMarkup: Math.round(averageDynamicMarkup * 100) / 100,
        },
        orders: {
          totalOrders: orders.length,
          totalOrderRevenue: Math.round(totalOrderRevenue * 100) / 100,
          totalMerchantRevenue: Math.round(totalMerchantRevenue * 100) / 100,
          totalMarkupRevenue: Math.round(totalMarkupRevenue * 100) / 100,
          markupPercentage: totalOrderRevenue > 0 
            ? Math.round((totalMarkupRevenue / totalOrderRevenue) * 100 * 100) / 100 
            : 0,
        },
        productPerformance: {
          productsWithHighMarkup: productsWithHighMarkup.length,
          productsWithLowStock: productsWithLowStock.length,
        },
        pricingDistribution,
      },
      message: 'Pricing analytics retrieved successfully',
    });
  } catch (error) {
    logger.error('Error getting pricing analytics', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    return sendError(res, {
      message: 'Failed to get pricing analytics',
      error: error.message,
    }, 500);
  }
};

/**
 * Get merchant pricing analytics
 * GET /api/analytics/pricing/merchant
 * Requires merchant role
 */
export const getMerchantPricingAnalytics = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return sendError(res, {
        message: 'Unauthorized',
        statusCode: 401,
        code: 'UNAUTHORIZED',
      });
    }

    // Get merchant
    const Merchant = (await import('../models/merchant.model.js')).default;
    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });
    
    if (!merchant) {
      return sendForbidden(res, 'Merchant not found or not approved');
    }

    // Get merchant's products
    const products = await Product.find({
      merchant: merchant._id,
      deletedAt: null,
      isActive: true,
    }).select('merchantPrice nubianMarkup dynamicMarkup finalPrice price discountPrice stock').lean();

    // Get merchant's orders
    const orders = await Order.find({
      merchants: merchant._id,
      status: { $in: ['confirmed', 'shipped', 'delivered'] },
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
    }).select('products totalAmount finalAmount merchantRevenue createdAt').lean();

    // Calculate merchant revenue
    let totalMerchantRevenue = 0;
    let totalFinalPrice = 0;

    orders.forEach(order => {
      // Find merchant's revenue from this order
      if (order.merchantRevenue && Array.isArray(order.merchantRevenue)) {
        const merchantRevenue = order.merchantRevenue.find(
          mr => mr.merchant?.toString() === merchant._id.toString() || mr.merchant?.toString() === merchant._id.toString()
        );
        if (merchantRevenue) {
          totalMerchantRevenue += merchantRevenue.amount || 0;
        }
      }

      // Calculate total final price from merchant's products in order
      if (order.products && Array.isArray(order.products)) {
        order.products.forEach(item => {
          // Check if this product belongs to merchant (would need to populate to check)
          // For now, estimate based on order total
          totalFinalPrice += (item.price || 0) * (item.quantity || 1);
        });
      }
    });

    // Calculate average pricing
    const productsWithPricing = products.filter(p => {
      const merchantPrice = p.merchantPrice || p.price || 0;
      return merchantPrice > 0;
    });

    const averageFinalPrice = productsWithPricing.length > 0
      ? productsWithPricing.reduce((sum, p) => {
          const finalPrice = p.finalPrice || p.discountPrice || p.price || 0;
          return sum + finalPrice;
        }, 0) / productsWithPricing.length
      : 0;

    const averageMerchantPrice = productsWithPricing.length > 0
      ? productsWithPricing.reduce((sum, p) => sum + (p.merchantPrice || p.price || 0), 0) / productsWithPricing.length
      : 0;

    // Alert: products where finalPrice exceeds merchantPrice + X%
    const ALERT_THRESHOLD = 50; // 50% markup threshold
    const productsWithHighMarkup = products.filter(p => {
      const merchantPrice = p.merchantPrice || p.price || 0;
      const finalPrice = p.finalPrice || p.discountPrice || p.price || 0;
      if (merchantPrice === 0) return false;
      const markupPercentage = ((finalPrice - merchantPrice) / merchantPrice) * 100;
      return markupPercentage > ALERT_THRESHOLD;
    });

    return sendSuccess(res, {
      data: {
        summary: {
          totalProducts: products.length,
          averageMerchantPrice: Math.round(averageMerchantPrice * 100) / 100,
          averageFinalPrice: Math.round(averageFinalPrice * 100) / 100,
          averageMarkup: averageMerchantPrice > 0
            ? Math.round(((averageFinalPrice - averageMerchantPrice) / averageMerchantPrice) * 100 * 100) / 100
            : 0,
        },
        orders: {
          totalOrders: orders.length,
          totalMerchantRevenue: Math.round(totalMerchantRevenue * 100) / 100,
        },
        alerts: {
          productsWithHighMarkup: productsWithHighMarkup.length,
          productsWithHighMarkupList: productsWithHighMarkup.map(p => ({
            _id: p._id,
            name: p.name || 'Unknown',
            merchantPrice: p.merchantPrice || p.price || 0,
            finalPrice: p.finalPrice || p.discountPrice || p.price || 0,
            markupPercentage: ((p.finalPrice || p.discountPrice || p.price || 0) - (p.merchantPrice || p.price || 0)) / (p.merchantPrice || p.price || 1) * 100,
          })),
        },
      },
      message: 'Merchant pricing analytics retrieved successfully',
    });
  } catch (error) {
    logger.error('Error getting merchant pricing analytics', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    return sendError(res, {
      message: 'Failed to get merchant pricing analytics',
      error: error.message,
    }, 500);
  }
};
