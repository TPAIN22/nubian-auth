import disputeService from "../services/dispute.service.js";
import Dispute from "../models/dispute.model.js";
import { sendSuccess, sendError } from "../lib/response.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";
import logger from "../lib/logger.js";

// Helper to get local User ID from Clerk ID
const getLocalUser = async (req) => {
    const { userId } = getAuth(req);
    if (!userId) return null;
    return await User.findOne({ clerkId: userId });
};

export const resolveDispute = async (req, res) => {
  try {
    const user = await getLocalUser(req);
    if (!user) return sendError(res, { message: "User not found", statusCode: 404 });

    // Admin/Support only
    if (user.role !== 'admin' && user.role !== 'support') {
        return sendError(res, { message: "Unauthorized", statusCode: 403 });
    }

    const { resolution, approvedAmount, adminNote } = req.body;
    // resolution: 'refund_full', 'refund_partial', 'rejected'

    const dispute = await disputeService.resolveDispute(
        req.params.id,
        resolution,
        approvedAmount, // Optional, for partial
        adminNote,
        user._id
    );

    return sendSuccess(res, { data: dispute, message: "Dispute resolved successfully" });
  } catch (error) {
    logger.error("Resolve Dispute Error", { error: error.message });
    return sendError(res, { message: error.message, statusCode: 500 });
  }
};

export const getDispute = async (req, res) => {
    try {
        const user = await getLocalUser(req);
        if (!user || (user.role !== 'admin' && user.role !== 'support')) {
            return sendError(res, { message: "Unauthorized", statusCode: 403 });
        }

        const dispute = await Dispute.findById(req.params.id)
            .populate('ticketId')
            .populate('merchantId')
            .populate('orderId')
            .lean();

        if (!dispute) {
            return sendError(res, { message: "Dispute not found", statusCode: 404 });
        }

        return sendSuccess(res, { data: dispute });
    } catch (error) {
        logger.error("Get Dispute Error", { error: error.message });
        return sendError(res, { message: error.message, statusCode: 500 });
    }
}
