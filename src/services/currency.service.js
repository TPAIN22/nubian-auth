import logger from "../lib/logger.js";
import Currency from "../models/currency.model.js";
import { getLatestRate } from "./fx.service.js";

/**
 * Default currency config fallback
 */
function getDefaultCurrencyConfig(code = "USD") {
  return {
    code,
    symbol: code === "USD" ? "$" : code,
    decimals: 2,
    roundingStrategy: "NONE",
    symbolPosition: "before",
    marketMarkupAdjustment: 0,
    locale: code === "SAR" ? "ar-SA" : "en-US",
  };
}

/**
 * Convert USD → Currency
 */
export async function convertUSDToCurrency(amountUSD, currencyCode) {
  const upperCode = currencyCode?.toUpperCase() || "USD";

  if (upperCode === "USD") {
    return {
      amountConverted: amountUSD,
      rate: 1,
      date: new Date().toISOString().split("T")[0],
      rateUnavailable: false,
      provider: "system",
    };
  }

  const rateInfo = await getLatestRate(upperCode);

  if (rateInfo.rateUnavailable || rateInfo.rate === null) {
    return {
      amountConverted: amountUSD,
      rate: 1,
      date: null,
      rateUnavailable: true,
      provider: "none",
    };
  }

  return {
    amountConverted: amountUSD * rateInfo.rate,
    rate: rateInfo.rate,
    date: rateInfo.date,
    rateUnavailable: false,
    provider: rateInfo.provider,
  };
}

/**
 * Psychological Pricing
 */
export function applyPsychologicalPricing(amount, currencyConfig) {
  if (!amount || amount <= 0) return 0;

  const strategy = currencyConfig?.roundingStrategy || "NONE";
  const decimals = currencyConfig?.decimals ?? 2;

  switch (strategy) {
    case "NONE":
      return parseFloat(amount.toFixed(decimals));

    case "NEAREST_1":
      return Math.round(amount);

    case "NEAREST_5":
      return Math.round(amount / 5) * 5;

    case "NEAREST_10":
      return Math.round(amount / 10) * 10;

    case "ENDING_9":
      return applyEnding9Strategy(amount);

    case "CUSTOM":
      return applyCustomRounding(amount, currencyConfig);

    default:
      return parseFloat(amount.toFixed(decimals));
  }
}

/**
 * FIXED ENDING_9 strategy
 */
function applyEnding9Strategy(amount) {
  if (amount < 10) {
    const floored = Math.floor(amount);
    return Math.max(0.99, floored + 0.99);
  }

  if (amount < 100) {
    const tens = Math.floor(amount / 10);
    return tens * 10 + 9.99;
  }

  if (amount < 1000) {
    const hundreds = Math.floor(amount / 100);
    return hundreds * 100 + 99;
  }

  const rounded = Math.round(amount / 100) * 100;
  return rounded - 1;
}

/**
 * Custom rounding
 */
function applyCustomRounding(amount, currencyConfig) {
  const rules = currencyConfig?.customRoundingRules;
  if (!rules) return Math.round(amount);

  const sortedRanges = Object.values(rules).sort(
    (a, b) => (a.max || Infinity) - (b.max || Infinity)
  );

  for (const rule of sortedRanges) {
    if (amount < (rule.max || Infinity)) {
      if (rule.round !== undefined) {
        const base = Math.floor(amount / rule.round) * rule.round;
        return base + (rule.offset || 0);
      }
      if (rule.nearest) {
        return Math.round(amount / rule.nearest) * rule.nearest + (rule.offset || 0);
      }
    }
  }

  return Math.round(amount);
}

/**
 * Format price with locale support
 */
export function formatPrice(amount, currencyConfig) {
  if (amount === null || amount === undefined) return "";

  const config = currencyConfig || getDefaultCurrencyConfig();
  const decimals = config.decimals ?? 2;
  const symbol = config.symbol;
  const position = config.symbolPosition || "before";
  const locale = config.locale || "en-US";

  const formattedNumber = amount.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return position === "after"
    ? `${formattedNumber} ${symbol}`
    : `${symbol}${formattedNumber}`;
}

/**
 * CORE sync converter (optimized)
 */
export function convertAndFormatPriceSync(amountUSD, currencyCode, rateInfo, currencyConfig) {
  const upperCode = currencyCode?.toUpperCase() || "USD";
  const config = currencyConfig || getDefaultCurrencyConfig(upperCode);

  let amountConverted = amountUSD;
  let rate = 1;
  let rateUnavailable = false;

  if (upperCode !== "USD") {
    if (!rateInfo || rateInfo.rateUnavailable || rateInfo.rate === null) {
      rateUnavailable = true;
    } else {
      rate = rateInfo.rate;
      amountConverted = amountUSD * rate;
    }
  }

  let finalAmount = amountConverted;

  // ✅ APPLY MARKUP FIRST (FIXED)
  if (!rateUnavailable) {
    const markup = config.marketMarkupAdjustment || 0;
    if (markup !== 0) {
      finalAmount += (finalAmount * markup) / 100;
    }

    // ✅ THEN APPLY PSYCHOLOGICAL PRICING
    finalAmount = applyPsychologicalPricing(finalAmount, config);
  }

  const priceDisplay = formatPrice(finalAmount, config);

  return {
    priceUSD: amountUSD,
    priceConverted: finalAmount,
    priceDisplay,
    currencyCode: upperCode,
    symbol: config.symbol,
    rate,
    rateDate: rateInfo?.date,
    rateProvider: rateInfo?.provider,
    rateUnavailable,
  };
}

/**
 * Convert Product Prices (OPTIMIZED)
 */
export async function convertProductPrices(product, currencyCode, context = {}) {
  if (!product) return product;

  const upperCode = currencyCode?.toUpperCase() || "USD";

  let config = context.config;
  let rate = context.rate;

  if (!config && upperCode !== "USD") {
    config = await Currency.findOne({ code: upperCode }).lean();
  }
  if (!rate && upperCode !== "USD") {
    rate = await getLatestRate(upperCode);
  }

  config = config || getDefaultCurrencyConfig(upperCode);

  // ✅ MEMOIZATION (performance boost)
  const cache = new Map();

  const convert = (val) => {
    if (val === undefined || val === null) return val;
    if (cache.has(val)) return cache.get(val);

    const result = convertAndFormatPriceSync(val, upperCode, rate, config);
    cache.set(val, result);
    return result;
  };

  const result = { ...product };

  // ROOT
  if (product.finalPrice !== undefined) {
    const c = convert(product.finalPrice);
    result.finalPrice = c.priceConverted;
    result.priceDisplay = c.priceDisplay;
  }

  if (product.originalPrice !== undefined) {
    result.originalPrice = convert(product.originalPrice).priceConverted;
  }

  if (product.discountPrice > 0) {
    const c = convert(product.discountPrice);
    result.discountPrice = c.priceConverted;
    result.discountPriceDisplay = c.priceDisplay;
  }

  // VARIANTS — convert every per-variant price field set by the pricing engine
  // so the strikethrough/savings shown to the customer match the converted final price.
  if (Array.isArray(product.variants)) {
    result.variants = product.variants.map((v) => {
      const vr = { ...v };
      if (v.finalPrice !== undefined) {
        const c = convert(v.finalPrice);
        vr.finalPrice = c.priceConverted;
        vr.priceDisplay = c.priceDisplay;
      }
      if (v.originalPrice !== undefined) {
        vr.originalPrice = convert(v.originalPrice).priceConverted;
      }
      if (v.listPrice !== undefined) {
        vr.listPrice = convert(v.listPrice).priceConverted;
      }
      if (v.discountAmount !== undefined) {
        vr.discountAmount = convert(v.discountAmount).priceConverted;
      }
      return vr;
    });
  }

  return result;
}

/**
 * FX Snapshot for orders
 */
export async function getFxSnapshotForOrder(currencyCode) {
  const upperCode = currencyCode?.toUpperCase() || "USD";
  const rateInfo = await getLatestRate(upperCode);

  return {
    base: "USD",
    date: rateInfo.date || new Date().toISOString().split("T")[0],
    rate: rateInfo.rate || 1,
    provider: rateInfo.provider || "system",
  };
}