import { sendSuccess, sendError } from "../lib/response.js";
import logger from "../lib/logger.js";
import { fetchLatestRates, getLatestExchangeRateDoc } from "../services/fx.service.js";

/**
 * Get the latest exchange rates
 * GET /fx/latest
 */
export const getLatestRates = async (req, res) => {
  try {
    const latestRates = await getLatestExchangeRateDoc();

    if (!latestRates) {
      return sendSuccess(res, {
        data: {
          hasRates: false,
          message: "No exchange rates available. Run a manual refresh or wait for the daily cron.",
        },
        message: "No exchange rates found",
      });
    }

    return sendSuccess(res, {
      data: {
        hasRates: true,
        base: latestRates.base,
        date: latestRates.date,
        rates: latestRates.rates,
        fetchedAt: latestRates.fetchedAt,
        provider: latestRates.provider,
        fetchStatus: latestRates.fetchStatus,
        missingCurrencies: latestRates.missingCurrencies,
      },
      message: "Exchange rates retrieved successfully",
    });
  } catch (error) {
    logger.error("Failed to fetch exchange rates", { error: error.message });
    return sendError(res, {
      message: "Failed to fetch exchange rates",
      code: "FETCH_ERROR",
      statusCode: 500,
    });
  }
};

/**
 * Manually refresh exchange rates (admin only)
 * POST /admin/fx/refresh
 */
export const refreshRates = async (req, res) => {
  try {
    logger.info("Manual FX refresh triggered by admin");

    const result = await fetchLatestRates();

    if (result.success) {
      logger.info("Manual FX refresh completed successfully", {
        date: result.date,
        ratesCount: result.ratesCount,
      });

      return sendSuccess(res, {
        data: {
          success: true,
          date: result.date,
          ratesCount: result.ratesCount,
          rates: result.rates,
          missingCurrencies: result.missingCurrencies,
        },
        message: "Exchange rates refreshed successfully",
      });
    } else {
      return sendError(res, {
        message: "Failed to refresh exchange rates",
        code: "FX_REFRESH_FAILED",
        statusCode: 500,
        details: { errors: result.errors },
      });
    }
  } catch (error) {
    logger.error("Manual FX refresh failed", { error: error.message });
    return sendError(res, {
      message: "Failed to refresh exchange rates",
      code: "FX_REFRESH_ERROR",
      statusCode: 500,
    });
  }
};
