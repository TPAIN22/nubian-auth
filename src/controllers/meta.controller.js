import Country from "../models/country.model.js";
import Currency from "../models/currency.model.js";
import { sendSuccess, sendError } from "../lib/response.js";
import { listInputEligibleCurrencies } from "../services/currency.service.js";
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
 * Currencies a merchant may ENTER a price in.
 * GET /meta/input-currencies
 *
 * Distinct from /meta/currencies, which lists what a SHOPPER may view prices
 * in. Viewing tolerates a missing rate (the read path falls back to showing
 * dollars); entering does not — a price typed in a currency with no rate cannot
 * be converted to the USD the platform stores, and guessing 1:1 would silently
 * misprice the product. So this endpoint returns only active currencies that
 * hold a usable rate right now, plus the rate itself so the dashboard can show
 * the merchant the conversion before they commit to it.
 */
export const getInputCurrencies = async (req, res) => {
  try {
    const currencies = await listInputEligibleCurrencies();

    return sendSuccess(res, {
      data: currencies,
      message: "Input-eligible currencies retrieved successfully",
    });
  } catch (error) {
    logger.error("Failed to fetch input-eligible currencies", { error: error.message });
    return sendError(res, {
      message: "Failed to fetch input currencies",
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
