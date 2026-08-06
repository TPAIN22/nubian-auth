// controllers/pricingAnalytics.controller.js
import { getAuth } from '@clerk/express';
import { clerkClient } from '@clerk/express';
import { sendSuccess, sendError, sendForbidden } from '../lib/response.js';
import logger from '../lib/logger.js';
import Product from '../models/product.model.js';
import Order from '../models/orders.model.js';
import mongoose from 'mongoose';
import { DEFAULT_NUBIAN_MARKUP } from '../lib/pricing.config.js';
import { calculateProductPricing } from '../lib/pricing.engine.js';

// Every product-serving surface reads pricing from the engine. Analytics used
// to read `finalPrice || discountPrice || price` off the raw document instead:
// `discountPrice` and `price` are dead schema fields, and the stored
// `finalPrice` is 0 on bulk-imported products until the hourly cron runs.
// See PRICING_AUDIT_REPORT Issue #23.
//
// Returns [{ product, pricing }] where `pricing` is the engine's root block
// (cheapest ACTIVE variant): basePrice (= merchant cost), listPrice,
// originalPrice, finalPrice, discountAmount, discountPercentage, hasDiscount
// and a `breakdown` carrying the real nubianMarkup / dynamicMarkup.
function priceProducts(products) {
  return (products || []).map((product) => ({
    product,
    pricing: calculateProductPricing(product).root,
  }));
}

/** Effective markup % actually charged over merchant cost, discounts included. */
function effectiveMarkupPercentage(pricing) {
  const cost = pricing?.basePrice || 0;
  if (!(cost > 0)) return 0;
  return ((pricing.finalPrice - cost) / cost) * 100;
}

// Fields calculateProductPricing() reads, plus the identity fields the
// responses below surface. Keep in sync with lib/pricing.engine.js.
const PRICING_PROJECTION =
  'name variants discount dynamicPricingEnabled stock';

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

    // Get all products with the fields the pricing engine reads
    const products = await Product.find({
      deletedAt: null,
      isActive: true,
    }).select(PRICING_PROJECTION).lean();

    // Live pricing, computed the same way every storefront endpoint computes it
    const priced = priceProducts(products);

    // Calculate revenue from markup
    const totalRevenueFromMarkup = priced.reduce((sum, { pricing }) => {
      const markupRevenue = pricing.finalPrice - pricing.basePrice;
      return sum + Math.max(0, markupRevenue);
    }, 0);

    // Calculate average markup percentage
    const productsWithMarkup = priced.filter(({ pricing }) => pricing.basePrice > 0);

    const averageNubianMarkup = productsWithMarkup.length > 0
      ? productsWithMarkup.reduce(
          (sum, { pricing }) => sum + (pricing.breakdown?.nubianMarkup ?? DEFAULT_NUBIAN_MARKUP),
          0
        ) / productsWithMarkup.length
      : DEFAULT_NUBIAN_MARKUP;

    const averageDynamicMarkup = productsWithMarkup.length > 0
      ? productsWithMarkup.reduce(
          (sum, { pricing }) => sum + (pricing.breakdown?.dynamicMarkup || 0),
          0
        ) / productsWithMarkup.length
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
    const productsWithHighMarkup = priced.filter(
      ({ pricing }) => (pricing.breakdown?.dynamicMarkup || 0) > 20 // High dynamic markup (>20%)
    );

    const productsWithLowStock = products.filter(p => {
      const stock = p.stock || 0;
      return stock > 0 && stock <= 10;
    });

    // Pricing distribution — on the LIVE final price, not the stored one
    const pricingDistribution = {
      low:    priced.filter(({ pricing }) => pricing.finalPrice > 0 && pricing.finalPrice < 100).length,
      medium: priced.filter(({ pricing }) => pricing.finalPrice >= 100 && pricing.finalPrice < 500).length,
      high:   priced.filter(({ pricing }) => pricing.finalPrice >= 500).length,
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
    const merchant = await Merchant.findOne({ userId, status: 'approved' });
    
    if (!merchant) {
      return sendForbidden(res, 'Merchant not found or not approved');
    }

    // Get merchant's products
    const products = await Product.find({
      merchant: merchant._id,
      deletedAt: null,
      isActive: true,
    }).select(PRICING_PROJECTION).lean();

    // Live pricing via the engine (see priceProducts).
    const priced = priceProducts(products);

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
    const productsWithPricing = priced.filter(({ pricing }) => pricing.basePrice > 0);

    const averageFinalPrice = productsWithPricing.length > 0
      ? productsWithPricing.reduce((sum, { pricing }) => sum + pricing.finalPrice, 0) /
        productsWithPricing.length
      : 0;

    const averageMerchantPrice = productsWithPricing.length > 0
      ? productsWithPricing.reduce((sum, { pricing }) => sum + pricing.basePrice, 0) /
        productsWithPricing.length
      : 0;

    // Alert: products where the live finalPrice exceeds merchant cost + X%.
    // The markup percentage is computed once by effectiveMarkupPercentage
    // rather than hand-rolled here and again in the response payload.
    const ALERT_THRESHOLD = 50; // 50% markup threshold
    const productsWithHighMarkup = priced
      .map(({ product, pricing }) => ({
        product,
        pricing,
        markupPercentage: effectiveMarkupPercentage(pricing),
      }))
      .filter(({ pricing, markupPercentage }) =>
        pricing.basePrice > 0 && markupPercentage > ALERT_THRESHOLD
      );

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
          productsWithHighMarkupList: productsWithHighMarkup.map(
            ({ product, pricing, markupPercentage }) => ({
              _id: product._id,
              name: product.name || 'Unknown',
              merchantPrice: pricing.basePrice,
              finalPrice: pricing.finalPrice,
              markupPercentage: Math.round(markupPercentage * 100) / 100,
            })
          ),
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

/**
 * Get currency-specific analytics for admin dashboard
 * GET /api/analytics/pricing/currencies
 * Requires admin role
 */
export const getCurrencyAnalytics = async (req, res) => {
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
      return sendForbidden(res, 'Only admins can access currency analytics');
    }

    // Get currency model
    const Currency = (await import('../models/currency.model.js')).default;
    
    // Get all active currencies
    const currencies = await Currency.find({ isActive: true })
      .select('code name symbol marketMarkupAdjustment roundingStrategy')
      .lean();

    // Query time range (last 30 days by default, or use query params)
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get orders with currency data from the specified period
    const orders = await Order.find({
      createdAt: { $gte: startDate },
      status: { $in: ['pending', 'confirmed', 'shipped', 'delivered'] },
    }).select('currencyCodeSelected fxSnapshot totalAmount finalAmount finalAmountConverted createdAt status').lean();

    // Aggregate orders by currency
    const currencyStats = {};
    
    // Initialize stats for all active currencies
    currencies.forEach(currency => {
      currencyStats[currency.code] = {
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
        marketMarkupAdjustment: currency.marketMarkupAdjustment || 0,
        orderCount: 0,
        totalRevenueUSD: 0,
        totalRevenueConverted: 0,
        averageFxRate: 0,
        fxRates: [],
        orders: {
          pending: 0,
          confirmed: 0,
          shipped: 0,
          delivered: 0,
        },
      };
    });

    // Process orders
    orders.forEach(order => {
      const currencyCode = order.currencyCodeSelected || 'USD';
      
      // Initialize if currency not in active list
      if (!currencyStats[currencyCode]) {
        currencyStats[currencyCode] = {
          code: currencyCode,
          name: currencyCode,
          symbol: currencyCode,
          marketMarkupAdjustment: 0,
          orderCount: 0,
          totalRevenueUSD: 0,
          totalRevenueConverted: 0,
          averageFxRate: 0,
          fxRates: [],
          orders: {
            pending: 0,
            confirmed: 0,
            shipped: 0,
            delivered: 0,
          },
        };
      }
      
      const stats = currencyStats[currencyCode];
      stats.orderCount += 1;
      stats.totalRevenueUSD += order.finalAmount || order.totalAmount || 0;
      stats.totalRevenueConverted += order.finalAmountConverted || order.finalAmount || 0;
      
      if (order.fxSnapshot?.rate) {
        stats.fxRates.push(order.fxSnapshot.rate);
      }
      
      if (order.status && stats.orders[order.status] !== undefined) {
        stats.orders[order.status] += 1;
      }
    });

    // Calculate averages and format results
    const currencyAnalytics = Object.values(currencyStats)
      .filter(stats => stats.orderCount > 0)
      .map(stats => ({
        ...stats,
        averageFxRate: stats.fxRates.length > 0
          ? Math.round((stats.fxRates.reduce((sum, r) => sum + r, 0) / stats.fxRates.length) * 10000) / 10000
          : 1,
        averageOrderValueUSD: stats.orderCount > 0
          ? Math.round((stats.totalRevenueUSD / stats.orderCount) * 100) / 100
          : 0,
        averageOrderValueConverted: stats.orderCount > 0
          ? Math.round((stats.totalRevenueConverted / stats.orderCount) * 100) / 100
          : 0,
        fxRates: undefined, // Remove raw rates array from response
      }))
      .sort((a, b) => b.totalRevenueUSD - a.totalRevenueUSD);

    // Summary stats
    const totalOrders = orders.length;
    const totalRevenueUSD = currencyAnalytics.reduce((sum, c) => sum + c.totalRevenueUSD, 0);
    const uniqueCurrencies = currencyAnalytics.length;

    // Top currency by order count
    const topCurrencyByOrders = currencyAnalytics.length > 0 
      ? currencyAnalytics.reduce((max, c) => c.orderCount > max.orderCount ? c : max, currencyAnalytics[0])
      : null;

    // Top currency by revenue
    const topCurrencyByRevenue = currencyAnalytics.length > 0
      ? currencyAnalytics.reduce((max, c) => c.totalRevenueUSD > max.totalRevenueUSD ? c : max, currencyAnalytics[0])
      : null;

    return sendSuccess(res, {
      data: {
        summary: {
          totalOrders,
          totalRevenueUSD: Math.round(totalRevenueUSD * 100) / 100,
          uniqueCurrencies,
          periodDays: days,
          topCurrencyByOrders: topCurrencyByOrders?.code || 'N/A',
          topCurrencyByRevenue: topCurrencyByRevenue?.code || 'N/A',
        },
        currencies: currencyAnalytics,
        activeCurrencies: currencies.map(c => ({
          code: c.code,
          name: c.name,
          symbol: c.symbol,
          marketMarkupAdjustment: c.marketMarkupAdjustment || 0,
        })),
      },
      message: 'Currency analytics retrieved successfully',
    });
  } catch (error) {
    logger.error('Error getting currency analytics', {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    return sendError(res, {
      message: 'Failed to get currency analytics',
      error: error.message,
    }, 500);
  }
};
