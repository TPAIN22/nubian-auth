import AffiliateService from "../services/affiliate.service.js";
import CommissionService from "../services/commission.service.js";
import { sendSuccess, sendError, sendCreated } from "../lib/response.js";
import { getAuth } from "@clerk/express";

/**
 * Register the current user as an affiliate marketer
 */
export const registerAsMarketer = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { name, phone } = req.body;

    const marketer = await AffiliateService.registerMarketer({
      userId, // Internal reference
      clerkId: userId,
      name,
      phone
    });

    return sendCreated(res, marketer, "Successfully registered as a marketer.");
  } catch (error) {
    return sendError(res, {
      message: error.message,
      code: "REGISTRATION_FAILED",
      statusCode: 400
    });
  }
};

/**
 * Get the current marketer's profile
 */
export const getMyProfile = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const marketer = await AffiliateService.getMarketerProfile(userId);

    if (!marketer) {
      return sendError(res, {
        message: "Marketer profile not found",
        code: "NOT_FOUND",
        statusCode: 404
      });
    }

    return sendSuccess(res, { data: marketer });
  } catch (error) {
    return sendError(res, { message: error.message });
  }
};

/**
 * Get real-time stats for the current marketer
 */
export const getMyStats = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const marketer = await AffiliateService.getMarketerByClerkId(userId);
    
    if (!marketer) {
      return sendError(res, { message: "Marketer profile not found", statusCode: 404 });
    }

    const stats = await AffiliateService.getStats(marketer._id);
    return sendSuccess(res, { data: stats });
  } catch (error) {
    return sendError(res, { message: error.message });
  }
};

/**
 * Get paginated commission history for the current marketer
 */
export const getMyCommissions = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { page, limit, status } = req.query;
    
    const marketer = await AffiliateService.getMarketerByClerkId(userId);
    if (!marketer) {
      return sendError(res, { message: "Marketer profile not found", statusCode: 404 });
    }

    const result = await CommissionService.getMarketerCommissions(marketer._id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status
    });

    return sendSuccess(res, { 
      data: result.items,
      meta: {
        pagination: {
          total: result.total,
          page: result.page,
          totalPages: result.totalPages
        }
      }
    });
  } catch (error) {
    return sendError(res, { message: error.message });
  }
};
