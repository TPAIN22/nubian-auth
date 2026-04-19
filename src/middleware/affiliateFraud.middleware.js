import ReferralFraudService from "../services/referralFraud.service.js";
import { sendError } from "../lib/response.js";
import { getAuth } from "@clerk/express";
import logger from "../lib/logger.js";

/**
 * Middleware to run fraud check on referral tracking
 */
export const checkReferralFraud = async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    const referralCode = req.referralCode || (req.body && req.body.referralCode);

    if (!referralCode) {
      return next(); // Nothing to check
    }

    const ip = req.ip || req.connection.remoteAddress;
    const deviceId = req.headers['x-device-id'] || (req.body && req.body.deviceId);

    const fraudResult = await ReferralFraudService.evaluateReferralRisk({
      referralCode: referralCode.toUpperCase(),
      ip,
      deviceId,
      userId
    });

    // Attach to request for controller use
    req.fraudResult = fraudResult;

    // If extremely high fraud score, we might want to block immediately
    if (fraudResult.fraudScore >= 100) {
      logger.warn("Blocking high-risk referral attempt", {
        referralCode,
        ip,
        reasons: fraudResult.reasons
      });
      return sendError(res, {
        message: "Suspicious activity detected.",
        code: "FRAUD_DETECTED",
        statusCode: 403,
        details: fraudResult.reasons
      });
    }

    next();
  } catch (error) {
    logger.error("Error in affiliate fraud middleware:", error);
    next(); // Fail open for tracking to avoid breaking user experience, but log it
  }
};
