import ReferralTrackingLog from "../models/referralTrackingLog.model.js";
import Marketer from "../models/marketer.model.js";
import { sendSuccess, sendError } from "../lib/response.js";
import { getAuth } from "@clerk/express";
import logger from "../lib/logger.js";

/**
 * Track a referral click
 */
export const trackReferral = async (req, res) => {
  try {
    const { referralCode, deviceId, platform, sessionId } = req.body;
    const { userId } = getAuth(req);
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // 1. Verify marketer exists and is active
    const marketer = await Marketer.findOne({ code: referralCode.toUpperCase(), status: 'active' });
    if (!marketer) {
      return sendError(res, {
        message: "Invalid or inactive referral code",
        code: "INVALID_CODE",
        statusCode: 400
      });
    }

    // 2. Create tracking log entry
    const log = await ReferralTrackingLog.create({
      referralCode: referralCode.toUpperCase(),
      ip,
      deviceId,
      userAgent,
      platform: platform || 'web',
      userId: userId || null,
      sessionId,
      fraudScore: req.fraudResult ? req.fraudResult.fraudScore : 0,
      flagged: req.fraudResult ? req.fraudResult.flagged : false,
      flagReasons: req.fraudResult ? req.fraudResult.reasons : [],
      behaviorData: {
        referrerUrl: req.headers['referer'] || null
      }
    });

    // 3. Increment total clicks on marketer profile (Async/Non-blocking)
    Marketer.findByIdAndUpdate(marketer._id, { $inc: { totalClicks: 1 } }).catch(err => {
      logger.error("Error incrementing marketer clicks:", err);
    });

    logger.info(`Referral click tracked: ${referralCode} from ${ip}`, {
      logId: log._id,
      fraudScore: log.fraudScore
    });

    return sendSuccess(res, {
      message: "Referral tracked successfully.",
      data: {
        referralCode: referralCode.toUpperCase(),
        id: log._id
      }
    });
  } catch (error) {
    logger.error("Error tracking referral:", error);
    return sendError(res, { message: "Internal tracking error" });
  }
};
