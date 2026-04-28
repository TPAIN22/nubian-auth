import Merchant from '../models/merchant.model.js';
import Product from '../models/product.model.js';
import Order from '../models/orders.model.js';
import User from '../models/user.model.js';
import logger from '../lib/logger.js';
import { sendSuccess } from '../lib/response.js';

/**
 * GET /api/analytics/overview
 *
 * Admin-only platform-wide overview. Returns counts and aggregate revenue
 * — the single source of truth for the dashboard's overview cards.
 *
 * Replaces the dashboard-side /api/admin/analytics that queried MongoDB
 * directly with the (now-removed) duplicate dashboard models.
 */
export const getAdminOverview = async (req, res) => {
  const [
    totalMerchants,
    pendingMerchants,
    suspendedMerchants,
    rejectedMerchants,
    totalProducts,
    activeProducts,
    flaggedProducts,
    totalOrders,
    pendingPaymentOrders,
    deliveredOrders,
    totalUsers,
    deliveredAggregate,
  ] = await Promise.all([
    Merchant.countDocuments({ status: 'approved' }),
    Merchant.countDocuments({ status: 'pending' }),
    Merchant.countDocuments({ status: 'suspended' }),
    Merchant.countDocuments({ status: 'rejected' }),
    Product.countDocuments({ deletedAt: null }),
    Product.countDocuments({ deletedAt: null, isActive: true }),
    Product.countDocuments({ deletedAt: null, isActive: false }),
    Order.countDocuments({}),
    Order.countDocuments({ paymentStatus: 'pending' }),
    Order.countDocuments({ status: 'delivered' }),
    User.countDocuments({}),
    Order.aggregate([
      { $match: { status: 'delivered', paymentStatus: 'paid' } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$finalAmount' },
          totalGrossRevenue: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const revenue = deliveredAggregate[0] || { totalRevenue: 0, totalGrossRevenue: 0, orderCount: 0 };

  logger.info('Admin overview retrieved', {
    requestId: req.requestId,
    userId: req.auth?.userId,
  });

  return sendSuccess(res, {
    message: 'Admin overview retrieved successfully',
    data: {
      merchants: {
        approved:  totalMerchants,
        pending:   pendingMerchants,
        suspended: suspendedMerchants,
        rejected:  rejectedMerchants,
      },
      products: {
        total:    totalProducts,
        active:   activeProducts,
        inactive: flaggedProducts,
      },
      orders: {
        total:          totalOrders,
        pendingPayment: pendingPaymentOrders,
        delivered:      deliveredOrders,
      },
      users: {
        total: totalUsers,
      },
      revenue: {
        // Net revenue from delivered + paid orders (after coupons/discounts)
        netDelivered:   revenue.totalRevenue,
        // Gross before discounts/coupons
        grossDelivered: revenue.totalGrossRevenue,
        deliveredOrderCount: revenue.orderCount,
      },
    },
  });
};
