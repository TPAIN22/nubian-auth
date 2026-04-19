import ReferralTrackingLog from "../models/referralTrackingLog.model.js";
import Marketer from "../models/marketer.model.js";
import logger from "../lib/logger.js";

class ReferralFraudService {
  /**
   * Evaluate the risk of a referral click/capture
   */
  async evaluateReferralRisk({ referralCode, ip, deviceId, userId }) {
    let fraudScore = 0;
    const reasons = [];

    // 1. Self-referral check
    if (userId) {
      const marketer = await Marketer.findOne({ code: referralCode });
      if (marketer && marketer.clerkId === userId) {
        fraudScore += 100;
        reasons.push("Self-referral attempt detected");
      }
    }

    // 2. IP abuse check (Too many clicks for same code from same IP)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const ipClickCount = await ReferralTrackingLog.countDocuments({
      referralCode,
      ip,
      createdAt: { $gte: twentyFourHoursAgo }
    });

    const maxClicks = parseInt(process.env.MAX_REFERRAL_CLICKS_PER_IP) || 10;
    if (ipClickCount >= maxClicks) {
      fraudScore += 40;
      reasons.push(`High frequency of clicks from same IP (${ipClickCount})`);
    }

    // 3. Device abuse check
    if (deviceId) {
      const deviceClickCount = await ReferralTrackingLog.countDocuments({
        referralCode,
        deviceId,
        createdAt: { $gte: twentyFourHoursAgo }
      });

      if (deviceClickCount >= 5) {
        fraudScore += 50;
        reasons.push(`High frequency of clicks from same device (${deviceClickCount})`);
      }

      // 4. Multiple accounts from same device (Simplified check)
      const uniqueUsersOnDevice = await ReferralTrackingLog.distinct("userId", {
        deviceId,
        userId: { $ne: null }
      });

      if (uniqueUsersOnDevice.length > 2) {
        fraudScore += 30;
        reasons.push(`Multiple user accounts (${uniqueUsersOnDevice.length}) linked to this device`);
      }
    }

    // Cap score at 100
    fraudScore = Math.min(fraudScore, 100);
    const threshold = parseInt(process.env.FRAUD_SCORE_THRESHOLD) || 80;

    return {
      fraudScore,
      flagged: fraudScore >= threshold,
      reasons
    };
  }

  /**
   * Log suspicious activity for future audit
   */
  async logSuspiciousActivity(marketerId, reason, severity = "medium") {
    try {
      await Marketer.findByIdAndUpdate(marketerId, {
        $push: { suspiciousFlags: `${severity.toUpperCase()}: ${reason} - ${new Date().toISOString()}` },
        $inc: { fraudScore: severity === "high" ? 20 : 5 }
      });
    } catch (error) {
      logger.error("Error logging suspicious activity:", error);
    }
  }
}

export default new ReferralFraudService();
