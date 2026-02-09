import logger from "../lib/logger.js";
import ExchangeRate from "../models/exchangeRate.model.js";
import Currency from "../models/currency.model.js";

/**
 * FX Service
 * Handles fetching exchange rates from the Frankfurter API
 * and persisting them to the database.
 */

const FRANKFURTER_BASE_URL = "https://api.frankfurter.dev/v1";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000; // 2 seconds

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the latest exchange rates from Frankfurter API
 * @param {string[]} symbols - Array of currency codes to fetch (excluding USD)
 * @returns {Promise<{date: string, rates: Object}>}
 */
async function fetchFromFrankfurter(symbols) {
  if (!symbols || symbols.length === 0) {
    return { date: null, rates: {} };
  }

  // Frankfurter supported symbols
  const SUPPORTED_SYMBOLS = [
    "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", 
    "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", 
    "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", 
    "THB", "TRY", "ZAR", "AED", "SAR", "EGP" // Note: EGP is sometimes supported, but Frankfurter dev often changes
  ];

  // Filter out USD and currencies NOT in the supported list
  const validSymbols = symbols
    .map((s) => s.toUpperCase().trim())
    .filter((s) => s !== "USD" && s.length === 3 && SUPPORTED_SYMBOLS.includes(s));

  if (validSymbols.length === 0) {
    logger.info("No Frankfurter-supported symbols requested. Skipping API call.");
    return { date: new Date().toISOString().split("T")[0], rates: {} };
  }

  const symbolsParam = validSymbols.join(",");
  const url = `${FRANKFURTER_BASE_URL}/latest?base=USD&symbols=${symbolsParam}`;

  logger.info("Fetching exchange rates from Frankfurter", {
    url,
    symbols: validSymbols,
  });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Frankfurter API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Frankfurter returns: { amount: 1, base: "USD", date: "2024-01-15", rates: { "EGP": 30.85, ... } }
  return {
    date: data.date,
    rates: data.rates || {},
  };
}

/**
 * Fetch latest exchange rates with retry logic
 * @param {string[]} symbols - Currency codes to fetch
 * @param {number} attempt - Current attempt number
 * @returns {Promise<{date: string, rates: Object, errors: string[]}>}
 */
async function fetchWithRetry(symbols, attempt = 1) {
  try {
    const result = await fetchFromFrankfurter(symbols);
    return { ...result, errors: [] };
  } catch (error) {
    const errorMessage = error.message || "Unknown error";

    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
      logger.warn(`FX fetch attempt ${attempt} failed, retrying in ${delay}ms`, {
        error: errorMessage,
        attempt,
        maxRetries: MAX_RETRIES,
      });
      await sleep(delay);
      return fetchWithRetry(symbols, attempt + 1);
    }

    logger.error("FX fetch failed after all retries", {
      error: errorMessage,
      attempts: attempt,
    });

    return {
      date: null,
      rates: {},
      errors: [errorMessage],
    };
  }
}

/**
 * Fetch and persist the latest exchange rates for all active currencies
 * This is the main entry point for the cron job and manual refresh
 * @returns {Promise<{success: boolean, date: string, ratesCount: number, errors: string[], missingCurrencies: string[]}>}
 */
export async function fetchLatestRates() {
  const startTime = Date.now();

  try {
    // Get all active currencies (excluding USD)
    const activeCurrencies = await Currency.find({ isActive: true, code: { $ne: "USD" } })
      .select("code")
      .lean();

    const symbols = activeCurrencies.map((c) => c.code);

    if (symbols.length === 0) {
      logger.info("No active non-USD currencies to fetch rates for");
      return {
        success: true,
        date: new Date().toISOString().split("T")[0],
        ratesCount: 0,
        errors: [],
        missingCurrencies: [],
      };
    }

    logger.info("Starting FX rate fetch", { currencies: symbols });

    const { date, rates, errors } = await fetchWithRetry(symbols);

    // We proceed even if rates is empty, as long as we have symbols, 
    // to create a record of the fetch attempt and handle manual fallbacks.
    const effectiveDate = date || new Date().toISOString().split("T")[0];

    // Check which currencies were requested but not returned
    const returnedCurrencies = Object.keys(rates);
    const missingCurrencies = symbols.filter((s) => !returnedCurrencies.includes(s));

    if (missingCurrencies.length > 0) {
      logger.warn("Some currencies not available from provider", {
        missing: missingCurrencies,
        available: returnedCurrencies,
      });
    }

    // Persist to database (upsert for idempotency)
    const exchangeRate = await ExchangeRate.upsertRates({
      base: "USD",
      date,
      rates,
      provider: "frankfurter",
      fetchStatus: missingCurrencies.length > 0 ? "partial" : "success",
      fetchErrors: errors,
      missingCurrencies,
    });

    const durationMs = Date.now() - startTime;

    logger.info("✅ FX rates updated successfully", {
      date,
      ratesCount: Object.keys(rates).length,
      missingCurrencies,
      durationMs,
    });

    return {
      success: true,
      date,
      ratesCount: Object.keys(rates).length,
      errors,
      missingCurrencies,
      rates,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error("Failed to fetch/persist FX rates", {
      error: error.message,
      stack: error.stack,
      durationMs,
    });

    return {
      success: false,
      date: null,
      ratesCount: 0,
      errors: [error.message],
      missingCurrencies: [],
    };
  }
}

/**
 * Get the latest exchange rate for a specific currency
 * @param {string} currencyCode
 * @returns {Promise<{rate: number|null, date: string|null, provider: string, rateUnavailable: boolean}>}
 */
export async function getLatestRate(currencyCode) {
  const upperCode = currencyCode.toUpperCase();

  // USD is always 1
  if (upperCode === "USD") {
    return {
      rate: 1,
      date: new Date().toISOString().split("T")[0],
      provider: "system",
      rateUnavailable: false,
    };
  }

  // Check if currency exists and has manual rate
  const currency = await Currency.findOne({ code: upperCode }).lean();
  if (currency?.allowManualRate && currency?.manualRate > 0) {
    return {
      rate: currency.manualRate,
      date: currency.manualRateUpdatedAt?.toISOString().split("T")[0] || null,
      provider: "manual",
      rateUnavailable: false,
    };
  }

  // Get from exchange rates
  const latestExchangeRate = await ExchangeRate.getLatest();
  if (!latestExchangeRate) {
    return {
      rate: null,
      date: null,
      provider: "frankfurter",
      rateUnavailable: true,
    };
  }

  const rate = latestExchangeRate.getRate
    ? latestExchangeRate.getRate(upperCode)
    : (latestExchangeRate.rates instanceof Map
        ? latestExchangeRate.rates.get(upperCode)
        : latestExchangeRate.rates?.[upperCode]) || null;

  return {
    rate,
    date: latestExchangeRate.date,
    provider: latestExchangeRate.provider,
    rateUnavailable: rate === null,
  };
}

/**
 * Get rates for multiple currencies
 * @param {string[]} currencyCodes
 * @returns {Promise<Object<string, {rate: number|null, date: string|null, provider: string}>>}
 */
export async function getLatestRatesForCurrencies(currencyCodes) {
  const result = {};

  for (const code of currencyCodes) {
    result[code.toUpperCase()] = await getLatestRate(code);
  }

  return result;
}

/**
 * Get the full latest exchange rate document
 * @returns {Promise<Object|null>}
 */
export async function getLatestExchangeRateDoc() {
  return ExchangeRate.getLatest();
}
