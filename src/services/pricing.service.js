import logger from "../lib/logger.js";
import ExchangeRate from "../models/exchangeRate.model.js";
import Currency from "../models/currency.model.js";

const FRANKFURTER_BASE_URL = "https://api.frankfurter.app";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ✅ NEW: in-memory cache
const fxCache = {
  rates: new Map(), // currency → rateInfo
  lastFetch: 0,
  TTL: 5 * 60 * 1000 // 5 minutes
};

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fetch from Frankfurter
 */
async function fetchFromFrankfurter(symbols) {
  const SUPPORTED_SYMBOLS = [
    "AUD","BGN","BRL","CAD","CHF","CNY","CZK","DKK","EUR","GBP",
    "HKD","HUF","IDR","ILS","INR","ISK","JPY","KRW","MXN",
    "MYR","NOK","NZD","PHP","PLN","RON","SEK","SGD",
    "THB","TRY","ZAR",
  ];

  const validSymbols = symbols
    .map((s) => s.toUpperCase())
    .filter((s) => s !== "USD" && SUPPORTED_SYMBOLS.includes(s));

  if (!validSymbols.length) {
    return { date: new Date().toISOString().split("T")[0], rates: {} };
  }

  const url = `${FRANKFURTER_BASE_URL}/latest?base=USD&symbols=${validSymbols.join(",")}`;

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`FX API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    date: data.date,
    rates: data.rates || {},
  };
}

/**
 * Retry wrapper
 */
async function fetchWithRetry(symbols, attempt = 1) {
  try {
    return await fetchFromFrankfurter(symbols);
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * attempt);
      return fetchWithRetry(symbols, attempt + 1);
    }
    throw err;
  }
}

/**
 * Fetch & persist rates
 */
export async function fetchLatestRates() {
  try {
    const currencies = await Currency.find({ isActive: true, code: { $ne: "USD" } })
      .select("code")
      .lean();

    const symbols = currencies.map(c => c.code);

    const { date, rates } = await fetchWithRetry(symbols);

    const exchangeRate = await ExchangeRate.upsertRates({
      base: "USD",
      date: date || new Date().toISOString().split("T")[0],
      rates,
      provider: "frankfurter"
    });

    // ✅ UPDATE CACHE
    Object.entries(rates).forEach(([code, rate]) => {
      fxCache.rates.set(code, {
        rate,
        date,
        provider: "frankfurter",
        rateUnavailable: false
      });
    });

    fxCache.lastFetch = Date.now();

    return {
      success: true,
      date,
      ratesCount: Object.keys(rates).length
    };

  } catch (error) {
    logger.error("FX fetch failed", { error: error.message });
    return { success: false };
  }
}

/**
 * 🔥 OPTIMIZED getLatestRate
 */
export async function getLatestRate(currencyCode) {
  const code = currencyCode.toUpperCase();

  if (code === "USD") {
    return {
      rate: 1,
      date: new Date().toISOString().split("T")[0],
      provider: "system",
      rateUnavailable: false,
    };
  }

  // ✅ 1. CACHE HIT
  const cached = fxCache.rates.get(code);
  if (cached && (Date.now() - fxCache.lastFetch < fxCache.TTL)) {
    return cached;
  }

  // ✅ 2. MANUAL RATE
  const currency = await Currency.findOne({ code }).lean();
  if (currency?.allowManualRate && currency?.manualRate > 0) {
    return {
      rate: currency.manualRate,
      date: currency.manualRateUpdatedAt?.toISOString().split("T")[0],
      provider: "manual",
      rateUnavailable: false,
    };
  }

  // ✅ 3. DB FALLBACK (once)
  const latest = await ExchangeRate.getLatest();

  if (!latest) {
    return {
      rate: null,
      date: null,
      provider: "none",
      rateUnavailable: true,
    };
  }

  const rate = latest.rates?.[code] ?? null;

  const result = {
    rate,
    date: latest.date,
    provider: latest.provider,
    rateUnavailable: rate === null,
  };

  // ✅ CACHE IT
  fxCache.rates.set(code, result);
  fxCache.lastFetch = Date.now();

  return result;
}

/**
 * 🔥 PARALLEL VERSION
 */
export async function getLatestRatesForCurrencies(currencyCodes) {
  const entries = await Promise.all(
    currencyCodes.map(async (code) => {
      const rate = await getLatestRate(code);
      return [code.toUpperCase(), rate];
    })
  );

  return Object.fromEntries(entries);
}