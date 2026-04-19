import Commission from "../models/commission.model.js";
import Marketer from "../models/marketer.model.js";
import Order from "../models/orders.model.js";
import mongoose from "mongoose";
import logger from "../lib/logger.js";

class CommissionService {
  /**
   * Create a pending commission from a delivered order
   */
  async createCommission(orderId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");
      if (!order.marketer) return null; // No marketer assigned to this order

      // Check if commission already exists
      const existing = await Commission.findOne({ order: orderId }).session(session);
      if (existing) return existing;

      const marketer = await Marketer.findById(order.marketer).session(session);
      if (!marketer) throw new Error("Marketer not found");

      const commissionAmount = order.finalAmount * marketer.commissionRate;

      // 1. Create commission record
      const commission = await Commission.create([{
        marketer: marketer._id,
        order: order._id,
        amount: commissionAmount,
        rate: marketer.commissionRate,
        orderAmount: order.finalAmount,
        status: 'pending'
      }], { session });

      // 2. Update order with commission info
      order.marketerCommission = commissionAmount;
      await order.save({ session });

      // 3. Update marketer pending earnings
      marketer.pendingEarnings += commissionAmount;
      marketer.totalOrders += 1;
      await marketer.save({ session });

      await session.commitTransaction();
      return commission[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error creating commission for order ${orderId}:`, error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Mark a commission as paid (Admin action)
   */
  async markAsPaid(commissionId, adminUserId, notes) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const commission = await Commission.findById(commissionId).session(session);
      if (!commission) throw new Error("Commission not found");
      if (commission.status === 'paid') throw new Error("Commission already paid");

      const marketer = await Marketer.findById(commission.marketer).session(session);
      if (!marketer) throw new Error("Marketer not found");

      // 1. Update commission record
      commission.status = 'paid';
      commission.paidAt = new Date();
      commission.paidBy = adminUserId;
      commission.notes = notes;
      await commission.save({ session });

      // 2. Update marketer profile
      marketer.pendingEarnings -= commission.amount;
      marketer.paidEarnings += commission.amount;
      marketer.totalEarnings += commission.amount;
      await marketer.save({ session });

      await session.commitTransaction();
      return commission;
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error marking commission ${commissionId} as paid:`, error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * List commissions for a marketer
   */
  async getMarketerCommissions(marketerId, { page = 1, limit = 20, status }) {
    const query = { marketer: marketerId };
    if (status) query.status = status;

    const skip = (page - 1) * limit;
    const items = await Commission.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("order", "orderNumber finalAmount status createdAt");

    const total = await Commission.countDocuments(query);

    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }
}

export default new CommissionService();
