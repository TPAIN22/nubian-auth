import Marketer from "../models/marketer.model.js";
import User from "../models/user.model.js";
import Order from "../models/orders.model.js";
import ReferralTrackingLog from "../models/referralTrackingLog.model.js";
import mongoose from "mongoose";
import logger from "../lib/logger.js";
import { clerkClient } from "@clerk/express";

class AffiliateService {
  /**
   * Register a user as a marketer
   */
  async registerMarketer({ userId, clerkId, name, phone }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Check if user exists, if not sync from Clerk
      let user = await User.findOne({ clerkId }).session(session);
      
      if (!user) {
        logger.info(`User record missing for ${clerkId}, attempting lazy sync...`);
        try {
          const clerkUser = await clerkClient.users.getUser(clerkId);
          const firstName = clerkUser.firstName || '';
          const lastName = clerkUser.lastName || '';
          
          user = await User.create([{
            clerkId,
            fullName: `${firstName} ${lastName}`.trim() || clerkUser.username || "User",
            emailAddress: clerkUser.emailAddresses?.[0]?.emailAddress || "",
            phone: clerkUser.phoneNumbers?.[0]?.phoneNumber || ""
          }], { session });
          user = user[0];
          logger.info(`User record lazy-synced for ${clerkId}`);
        } catch (clerkError) {
          logger.error(`Failed to sync user ${clerkId} from Clerk:`, clerkError);
          throw new Error("Unable to verify user account. Please try again later.");
        }
      }

      // 2. Check if already a marketer
      const existingMarketer = await Marketer.findOne({ clerkId }).session(session);
      if (existingMarketer) throw new Error("User is already registered as a marketer");

      // 3. Generate unique referral code
      const code = await this.generateUniqueCode(name);

      // 4. Create marketer profile
      const marketer = await Marketer.create([{
        user: user._id,
        clerkId,
        name,
        code,
        phone,
        referralLink: `${process.env.AFFILIATE_BASE_URL || 'https://nubian-sd.store'}?ref=${code}`
      }], { session });

      // 5. Update user role and referral code
      user.role = "marketer";
      user.referralCode = code;
      await user.save({ session });

      await session.commitTransaction();
      return marketer[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error registering marketer:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Generate a unique referral code based on name
   */
  async generateUniqueCode(name) {
    let baseCode = name.split(" ")[0].substring(0, 4).toUpperCase();
    // Remove non-alphanumeric characters
    baseCode = baseCode.replace(/[^A-Z0-9]/g, "");
    
    if (baseCode.length < 3) baseCode = "REF";

    let isUnique = false;
    let finalCode = "";
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
      finalCode = `${baseCode}${randomSuffix}`;
      
      const existing = await Marketer.findOne({ code: finalCode });
      if (!existing) isUnique = true;
      attempts++;
    }

    if (!isUnique) {
      finalCode = `NB${Date.now().toString().slice(-6)}`;
    }

    return finalCode;
  }

  /**
   * Get marketer profile with performance stats
   */
  async getMarketerProfile(clerkId) {
    const marketer = await Marketer.findOne({ clerkId }).populate("user", "fullName emailAddress phone");
    if (!marketer) return null;

    // Get real-time stats (optional, usually we rely on cached stats on the model)
    return marketer;
  }

  /**
   * Get marketer by Clerk ID
   */
  async getMarketerByClerkId(clerkId) {
    return Marketer.findOne({ clerkId });
  }

  /**
   * Get detailed stats for a marketer
   */
  async getStats(marketerId) {
    const stats = await Order.aggregate([
      { $match: { marketer: new mongoose.Types.ObjectId(marketerId) } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] }
          },
          totalRevenue: { $sum: "$finalAmount" },
          totalCommission: { $sum: "$marketerCommission" }
        }
      }
    ]);

    const marketer = await Marketer.findById(marketerId);
    const clicks = await ReferralTrackingLog.countDocuments({ 
      referralCode: marketer.code 
    });

    const result = stats[0] || { 
      totalOrders: 0, 
      completedOrders: 0, 
      totalRevenue: 0, 
      totalCommission: 0 
    };

    return {
      ...result,
      totalClicks: clicks,
      conversionRate: clicks > 0 ? (result.totalOrders / clicks) * 100 : 0
    };
  }

  /**
   * Get top marketers for leaderboard
   */
  async getTopMarketers(limit = 10) {
    return Marketer.find({ status: "active" })
      .sort({ totalEarnings: -1 })
      .limit(limit)
      .select("name code totalEarnings totalOrders");
  }
}

export default new AffiliateService();
