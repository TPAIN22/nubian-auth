import Country from "../models/country.model.js";
import Currency from "../models/currency.model.js";
import { sendSuccess, sendError } from "../lib/response.js";
import logger from "../lib/logger.js";

/**
 * Get all active countries for currency selection
 * GET /meta/countries
 */
export const getActiveCountries = async (req, res) => {
  try {
    const countries = await Country.find({ isActive: true })
      .sort({ sortOrder: 1, nameEn: 1 })
      .select("code nameEn nameAr defaultCurrencyCode sortOrder")
      .lean();

    return sendSuccess(res, {
      data: countries,
      message: "Active countries retrieved successfully",
    });
  } catch (error) {
    logger.error("Failed to fetch active countries", { error: error.message });
    return sendError(res, {
      message: "Failed to fetch countries",
      code: "FETCH_ERROR",
      statusCode: 500,
    });
  }
};

/**
 * Get all active currencies for selection
 * GET /meta/currencies
 */
export const getActiveCurrencies = async (req, res) => {
  try {
    const currencies = await Currency.find({ isActive: true })
      .sort({ sortOrder: 1, code: 1 })
      .select("code name nameAr symbol symbolPosition decimals roundingStrategy sortOrder")
      .lean();

    return sendSuccess(res, {
      data: currencies,
      message: "Active currencies retrieved successfully",
    });
  } catch (error) {
    logger.error("Failed to fetch active currencies", { error: error.message });
    return sendError(res, {
      message: "Failed to fetch currencies",
      code: "FETCH_ERROR",
      statusCode: 500,
    });
  }
};

/**
 * Get both countries and currencies in one call (for app initialization)
 * GET /meta/all
 */
export const getMetaData = async (req, res) => {
  try {
    const [countries, currencies] = await Promise.all([
      Country.find({ isActive: true })
        .sort({ sortOrder: 1, nameEn: 1 })
        .select("code nameEn nameAr defaultCurrencyCode sortOrder")
        .lean(),
      Currency.find({ isActive: true })
        .sort({ sortOrder: 1, code: 1 })
        .select("code name nameAr symbol symbolPosition decimals roundingStrategy sortOrder")
        .lean(),
    ]);

    return sendSuccess(res, {
      data: { countries, currencies },
      message: "Metadata retrieved successfully",
    });
  } catch (error) {
    logger.error("Failed to fetch metadata", { error: error.message });
    return sendError(res, {
      message: "Failed to fetch metadata",
      code: "FETCH_ERROR",
      statusCode: 500,
    });
  }
};
