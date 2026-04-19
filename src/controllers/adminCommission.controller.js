import Commission from "../models/commission.model.js";
import CommissionService from "../services/commission.service.js";
import Marketer from "../models/marketer.model.js";
import Order from "../models/orders.model.js";
import { sendSuccess, sendError, sendPaginated } from "../lib/response.js";
import logger from "../lib/logger.js";

/**
 * Get all commissions across the system with filtering
 */
export const getAllCommissions = async (req, res) => {
  try {
    const { page, limit, status, marketerId, startDate, endDate } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (marketerId) query.marketer = marketerId;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const p = parseInt(page) || 1;
    const l = parseInt(limit) || 10;
    
    const commissions = await Commission.find(query)
      .sort({ createdAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("marketer", "name code")
      .populate("order", "orderNumber finalAmount");

    const total = await Commission.countDocuments(query);

    return sendPaginated(res, {
      data: commissions,
      page: p,
      limit: l,
      total,
      message: "Commissions retrieved successfully"
    });
  } catch (error) {
    return sendError(res, { message: error.message });
  }
};

/**
 * Mark a commission as paid
 */
export const markCommissionPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const adminUserId = req.adminUser ? req.adminUser.userId : null;

    const commission = await CommissionService.markAsPaid(id, adminUserId, notes);
    return sendSuccess(res, { data: commission, message: "Commission marked as paid." });
  } catch (error) {
    return sendError(res, { message: error.message, statusCode: 400 });
  }
};

/**
 * Get aggregate affiliate analytics
 */
export const getAffiliateAnalytics = async (req, res) => {
  try {
    const totalMarketers = await Marketer.countDocuments();
    const activeMarketers = await Marketer.countDocuments({ status: 'active' });
    
    const earningsStats = await Marketer.aggregate([
      {
        $group: {
          _id: null,
          totalPaid: { $sum: "$paidEarnings" },
          totalPending: { $sum: "$pendingEarnings" },
          totalEarnings: { $sum: "$totalEarnings" }
        }
      }
    ]);

    const topMarketers = await Marketer.find()
      .sort({ totalEarnings: -1 })
      .limit(5)
      .select("name code totalEarnings totalOrders");

    return sendSuccess(res, {
      data: {
        counts: { totalMarketers, activeMarketers },
        finance: earningsStats[0] || { totalPaid: 0, totalPending: 0, totalEarnings: 0 },
        topMarketers
      }
    });
  } catch (error) {
    return sendError(res, { message: error.message });
  }
};

/**
 * Get daily conversion/referral stats
 */
export const getDailyStats = async (req, res) => {
  try {
    const days = 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const dailyStats = await Order.aggregate([
      { $match: { marketer: { $ne: null }, createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orders: { $sum: 1 },
          revenue: { $sum: "$finalAmount" },
          commission: { $sum: "$marketerCommission" }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    return sendSuccess(res, { data: dailyStats });
  } catch (error) {
    return sendError(res, { message: error.message });
  }
};

/**
 * Get monthly performance trends
 */
export const getMonthlyStats = async (req, res) => {
  try {
    const months = 6;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const monthlyStats = await Order.aggregate([
      { $match: { marketer: { $ne: null }, createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          orders: { $sum: 1 },
          revenue: { $sum: "$finalAmount" },
          commission: { $sum: "$marketerCommission" }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    return sendSuccess(res, { data: monthlyStats });
  } catch (error) {
    return sendError(res, { message: error.message });
  }
};
