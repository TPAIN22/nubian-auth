import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";
import Country from "../models/country.model.js";
import Currency from "../models/currency.model.js";
import { sendSuccess, sendError, sendNotFound } from "../lib/response.js";
import logger from "../lib/logger.js";

/**
 * Update user's country and currency preferences
 * PUT /me/preferences
 */
export const updatePreferences = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      return sendError(res, {
        message: "Authentication required",
        code: "AUTH_REQUIRED",
        statusCode: 401,
      });
    }

    const { countryCode, currencyCode } = req.body;

    // Validate at least one field is provided
    if (!countryCode && !currencyCode) {
      return sendError(res, {
        message: "At least one of countryCode or currencyCode is required",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const updateData = {};
    const validationErrors = [];

    // Validate countryCode if provided
    if (countryCode) {
      const country = await Country.findOne({
        code: countryCode.toUpperCase(),
        isActive: true,
      }).lean();

      if (!country) {
        validationErrors.push({
          field: "countryCode",
          message: "Invalid or inactive country code",
          value: countryCode,
        });
      } else {
        updateData.countryCode = countryCode.toUpperCase();
      }
    }

    // Validate currencyCode if provided
    if (currencyCode) {
      const currency = await Currency.findOne({
        code: currencyCode.toUpperCase(),
        isActive: true,
      }).lean();

      if (!currency) {
        validationErrors.push({
          field: "currencyCode",
          message: "Invalid or inactive currency code",
          value: currencyCode,
        });
      } else {
        updateData.currencyCode = currencyCode.toUpperCase();
      }
    }

    // Return validation errors if any
    if (validationErrors.length > 0) {
      return sendError(res, {
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        statusCode: 400,
        details: validationErrors,
      });
    }

    // Find and update user
    const user = await User.findOneAndUpdate(
      { clerkId: userId },
      { $set: updateData },
      { new: true }
    ).select("clerkId countryCode currencyCode updatedAt");

    if (!user) {
      return sendNotFound(res, "User");
    }

    logger.info("User preferences updated", {
      userId,
      countryCode: updateData.countryCode,
      currencyCode: updateData.currencyCode,
    });

    return sendSuccess(res, {
      data: {
        countryCode: user.countryCode,
        currencyCode: user.currencyCode,
        updatedAt: user.updatedAt,
      },
      message: "Preferences updated successfully",
    });
  } catch (error) {
    logger.error("Failed to update user preferences", {
      error: error.message,
      stack: error.stack,
    });
    return sendError(res, {
      message: "Failed to update preferences",
      code: "UPDATE_ERROR",
      statusCode: 500,
    });
  }
};

/**
 * Get user's current preferences
 * GET /me/preferences
 */
export const getPreferences = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      return sendError(res, {
        message: "Authentication required",
        code: "AUTH_REQUIRED",
        statusCode: 401,
      });
    }

    const user = await User.findOne({ clerkId: userId })
      .select("countryCode currencyCode")
      .lean();

    if (!user) {
      return sendNotFound(res, "User");
    }

    // Get full country and currency info
    const [country, currency] = await Promise.all([
      user.countryCode
        ? Country.findOne({ code: user.countryCode }).select("code nameEn nameAr").lean()
        : null,
      user.currencyCode
        ? Currency.findOne({ code: user.currencyCode }).select("code name symbol").lean()
        : null,
    ]);

    return sendSuccess(res, {
      data: {
        countryCode: user.countryCode,
        currencyCode: user.currencyCode,
        country,
        currency,
      },
      message: "Preferences retrieved successfully",
    });
  } catch (error) {
    logger.error("Failed to get user preferences", { error: error.message });
    return sendError(res, {
      message: "Failed to get preferences",
      code: "FETCH_ERROR",
      statusCode: 500,
    });
  }
};
