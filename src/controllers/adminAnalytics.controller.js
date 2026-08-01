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

/**
 * GET /api/analytics/timeseries?days=30
 *
 * Admin-only daily series powering the overview trend chart.
 *
 * ── On revenue and dates ────────────────────────────────────────────────────
 * The order model records no per-transition timestamps — there is no `paidAt`
 * or `deliveredAt`, only `createdAt`, `updatedAt` and the BANKAK-only
 * `bankakApproval.approvedAt`. So revenue CANNOT be bucketed by the day it was
 * actually collected.
 *
 * What this returns instead: for each day, the revenue from orders *placed*
 * that day which have since reached delivered + paid. That is a real,
 * reproducible number, but it has one property every consumer must respect —
 * recent days are still maturing. An order placed yesterday has not been
 * delivered yet, so yesterday's revenue reads low and will keep climbing for
 * days. `maturityDays` is returned so the client can mark that tail rather than
 * let an operator read it as a slump.
 *
 * Order counts have no such caveat: an order placed on a day is placed on that
 * day forever, which is why the count series is the primary one.
 *
 * Buckets are cut in Africa/Khartoum, not UTC — otherwise a 21:30 order in
 * Khartoum lands on the previous day's bar.
 */
const SERIES_TIMEZONE = 'Africa/Khartoum';

/** Days at the end of the window still likely to change as orders complete. */
const MATURITY_DAYS = 7;

export const getAdminTimeseries = async (req, res) => {
  // Clamp rather than reject: a bad `days` should not fail the dashboard.
  const requested = Number.parseInt(req.query.days, 10);
  const days = Number.isFinite(requested) ? Math.min(Math.max(requested, 7), 365) : 30;

  // Start at midnight Khartoum `days-1` days ago so the window covers whole
  // local days including today.
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);

  const buckets = await Order.aggregate([
    { $match: { createdAt: { $gte: start } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$createdAt',
            timezone: SERIES_TIMEZONE,
          },
        },
        orders: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        revenue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'delivered'] },
                  { $eq: ['$paymentStatus', 'paid'] },
                ],
              },
              '$finalAmount',
              0,
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const byDate = new Map(buckets.map((b) => [b._id, b]));

  // Densify: a day with no orders must appear as a zero, not as a gap. A sparse
  // series drawn as a line silently rescales the x-axis and invents a trend.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: SERIES_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const points = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = fmt.format(d);
    const b = byDate.get(key);
    points.push({
      date: key,
      orders: b?.orders ?? 0,
      delivered: b?.delivered ?? 0,
      cancelled: b?.cancelled ?? 0,
      pending: b?.pending ?? 0,
      revenue: Number((b?.revenue ?? 0).toFixed(2)),
    });
  }

  const totals = points.reduce(
    (acc, p) => ({
      orders: acc.orders + p.orders,
      delivered: acc.delivered + p.delivered,
      cancelled: acc.cancelled + p.cancelled,
      revenue: acc.revenue + p.revenue,
    }),
    { orders: 0, delivered: 0, cancelled: 0, revenue: 0 },
  );
  totals.revenue = Number(totals.revenue.toFixed(2));

  logger.info('Admin timeseries retrieved', {
    requestId: req.requestId,
    userId: req.auth?.userId,
    days,
  });

  return sendSuccess(res, {
    message: 'Admin timeseries retrieved successfully',
    data: {
      granularity: 'day',
      timezone: SERIES_TIMEZONE,
      range: { days, from: points[0]?.date ?? null, to: points[points.length - 1]?.date ?? null },
      // Revenue is bucketed by order-placed date, not collection date — see the
      // note above. Clients should surface this, not hide it.
      revenueBasis: 'orders_placed_that_day_now_delivered_and_paid',
      maturityDays: MATURITY_DAYS,
      points,
      totals,
    },
  });
};
