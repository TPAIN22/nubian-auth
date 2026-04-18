import logger from "../lib/logger.js";
import Currency from "../models/currency.model.js";
import { getLatestRate } from "./fx.service.js";

/**
 * Currency Conversion Service
 * Handles converting USD amounts to target currencies with psychological pricing
 */

/**
 * Convert an amount from USD to target currency
 * @param {number} amountUSD - Amount in USD
 * @param {string} currencyCode - Target currency code
 * @returns {Promise<{amountConverted: number, rate: number, date: string, rateUnavailable: boolean}>}
 */
export async function convertUSDToCurrency(amountUSD, currencyCode) {
  const upperCode = currencyCode?.toUpperCase() || "USD";

  // No conversion needed for USD
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
    // Return USD amount if rate unavailable
    return {
      amountConverted: amountUSD,
      rate: 1,
      date: null,
      rateUnavailable: true,
      provider: "none",
    };
  }

  const amountConverted = amountUSD * rateInfo.rate;

  return {
    amountConverted,
    rate: rateInfo.rate,
    date: rateInfo.date,
    rateUnavailable: false,
    provider: rateInfo.provider,
  };
}

/**
 * Apply psychological pricing strategy to an amount
 * @param {number} amount - The amount to round
 * @param {Object} currencyConfig - Currency configuration with roundingStrategy
 * @returns {number} - Rounded amount
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
      return applyEnding9Strategy(amount, decimals);

    case "CUSTOM":
      return applyCustomRounding(amount, currencyConfig);

    default:
      return parseFloat(amount.toFixed(decimals));
  }
}

/**
 * Apply ENDING_9 strategy based on amount magnitude
 * - < 10: x.99
 * - 10-100: x9.99
 * - 100-1000: x99 or nearest 10 - 0.01
 * - > 1000: nearest 100 - 1
 */
function applyEnding9Strategy(amount, decimals) {
  if (amount < 10) {
    // For small amounts: floor + 0.99
    // e.g., 7.23 -> 6.99, 9.50 -> 8.99
    const floored = Math.floor(amount);
    if (floored < 1) return 0.99;
    return floored - 1 + 0.99;
  }

  if (amount < 100) {
    // For amounts 10-100: end with 9.99
    // e.g., 45.67 -> 39.99 or 49.99
    const tens = Math.floor(amount / 10);
    const nearestTen = tens * 10;
    // Round to nearest X9.99
    if (amount - nearestTen > 5) {
      return nearestTen + 9.99;
    }
    return (tens - 1) * 10 + 9.99;
  }

  if (amount < 1000) {
    // For amounts 100-1000: end with 99 or 99.99
    // e.g., 456 -> 449 or 499
    const hundreds = Math.floor(amount / 100);
    const nearestHundred = hundreds * 100;
    if (amount - nearestHundred > 50) {
      return nearestHundred + 99;
    }
    return (hundreds - 1) * 100 + 99;
  }

  // For amounts > 1000: nearest 100 - 1
  // e.g., 1234 -> 1199, 4567 -> 4499
  const nearestHundred = Math.round(amount / 100) * 100;
  return nearestHundred - 1;
}

/**
 * Apply custom rounding rules from currency config
 * @param {number} amount
 * @param {Object} currencyConfig
 */
function applyCustomRounding(amount, currencyConfig) {
  const rules = currencyConfig?.customRoundingRules;
  if (!rules) return Math.round(amount);

  // Custom rules format: { "low": { "max": 10, "round": 0.99 }, ... }
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
 * Format a price for display
 * @param {number} amount - The amount to format
 * @param {Object} currencyConfig - Currency configuration
 * @returns {string} - Formatted price string
 */
export function formatPrice(amount, currencyConfig) {
  if (amount === null || amount === undefined) return "";

  const decimals = currencyConfig?.decimals ?? 2;
  const symbol = currencyConfig?.symbol || currencyConfig?.code || "$";
  const position = currencyConfig?.symbolPosition || "before";

  // Format number with thousands separators
  const formattedNumber = amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  if (position === "after") {
    return `${formattedNumber} ${symbol}`;
  }
  return `${symbol}${formattedNumber}`;
}

/**
 * Convert and format price with psychological pricing
 * @param {number} amountUSD - Amount in USD
 * @param {string} currencyCode - Target currency code
 * @returns {Promise<Object>} - Full price conversion result
 */
export async function convertAndFormatPrice(amountUSD, currencyCode, options = {}) {
  const upperCode = currencyCode?.toUpperCase() || "USD";
  const { preloadedConfig, preloadedRate } = options;

  // Use SYNC path if possible to avoid micro-task overhead
  if (preloadedConfig && (preloadedRate || upperCode === "USD")) {
    return convertAndFormatPriceSync(amountUSD, currencyCode, preloadedRate, preloadedConfig);
  }

  // Get currency config (use preloaded or fetch)
  let currencyConfig = preloadedConfig;
  if (!currencyConfig) {
    const currency = await Currency.findOne({ code: upperCode }).lean();
    currencyConfig = currency || {
      code: upperCode,
      symbol: upperCode === "USD" ? "$" : upperCode,
      decimals: 2,
      roundingStrategy: "NONE",
      symbolPosition: "before",
      marketMarkupAdjustment: 0,
    };
  }

  // Get Rate (use preloaded or fetch)
  let rateInfo = preloadedRate;
  if (!rateInfo) {
    if (upperCode === "USD") {
      rateInfo = { rate: 1, date: new Date().toISOString().split("T")[0], rateUnavailable: false, provider: "system" };
    } else {
      rateInfo = await getLatestRate(upperCode); 
    }
  }

  return convertAndFormatPriceSync(amountUSD, currencyCode, rateInfo, currencyConfig);
}

/**
 * Synchronous version of convertAndFormatPrice for hot loops
 */
export function convertAndFormatPriceSync(amountUSD, currencyCode, rateInfo, currencyConfig) {
  const upperCode = currencyCode?.toUpperCase() || "USD";
  
  // Use system default if no config provided (for USD)
  const config = currencyConfig || {
    code: "USD",
    symbol: "$",
    decimals: 2,
    roundingStrategy: "NONE",
    symbolPosition: "before",
    marketMarkupAdjustment: 0,
  };

  // Calculate Amount
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

  // Apply psychological pricing
  let finalAmount = amountConverted;
  if (!rateUnavailable) {
    finalAmount = applyPsychologicalPricing(finalAmount, config);
    
    const marketAdjustment = config.marketMarkupAdjustment || 0;
    if (marketAdjustment !== 0) {
      const adjustmentAmount = (finalAmount * marketAdjustment) / 100;
      finalAmount = finalAmount + adjustmentAmount;
      finalAmount = applyPsychologicalPricing(finalAmount, config);
    }
  }

  // Format
  const priceDisplay = formatPrice(finalAmount, config);

  return {
    priceUSD: amountUSD,
    priceConverted: finalAmount,
    priceDisplay,
    currencyCode: upperCode,
    symbol: config.symbol,
    rate: rate,
    rateDate: rateInfo?.date,
    rateProvider: rateInfo?.provider,
    rateUnavailable: rateUnavailable,
    roundingStrategy: config.roundingStrategy,
    marketMarkupAdjustment: config.marketMarkupAdjustment || 0,
  };
}

/**
 * Convert multiple prices for a product
 * Handles finalPrice and any other pricing fields
 * @param {Object} product - Product with pricing fields
 * @param {string} currencyCode - Target currency
 * @returns {Promise<Object>} - Product with converted prices
 */
export async function convertProductPrices(product, currencyCode, context = {}) {
  const upperCode = currencyCode?.toUpperCase() || "USD";
  if (!product) return product;

  // Optimization: If it's USD, we still want to add display fields but we can skip many steps
  // If preloaded context is missing, we must fetch (slow path)
  let config = context.config;
  let rate = context.rate;
  
  if (!config && upperCode !== "USD") {
    config = await Currency.findOne({ code: upperCode }).lean();
  }
  if (!rate && upperCode !== "USD") {
    rate = await getLatestRate(upperCode);
  }

  const convert = (val) => convertAndFormatPriceSync(val, upperCode, rate, config);

  const result = { ...product };
  
  // 1. Root-level standard fields
  if (product.finalPrice !== undefined) {
    const c = convert(product.finalPrice);
    result.finalPrice = c.priceConverted;
    result.priceConverted = c.priceConverted; 
    result.priceDisplay = c.priceDisplay;
    result.currencyCode = c.currencyCode;
    result.rate = c.rate;
    result.rateDate = c.rateDate;
    result.rateUnavailable = c.rateUnavailable;
  }

  if (product.merchantPrice !== undefined) {
    const c = convert(product.merchantPrice);
    result.merchantPrice = c.priceConverted;
    if (product.originalPrice === undefined) {
        result.originalPrice = c.priceConverted;
    }
  }

  if (product.originalPrice !== undefined) {
    result.originalPrice = convert(product.originalPrice).priceConverted;
  }

  if (product.displayFinalPrice !== undefined) {
      result.displayFinalPrice = convert(product.displayFinalPrice).priceConverted;
  }
  
  if (product.displayOriginalPrice !== undefined) {
      result.displayOriginalPrice = convert(product.displayOriginalPrice).priceConverted;
  }

  // RE-APPLY SANITY CHECK ON CONVERTED VALUES
  if (result.displayFinalPrice !== undefined && result.displayOriginalPrice !== undefined) {
      if (result.displayOriginalPrice > result.displayFinalPrice) {
          result.displayDiscountPercentage = Math.round(((result.displayOriginalPrice - result.displayFinalPrice) / result.displayOriginalPrice) * 100);
      } else {
          result.displayOriginalPrice = result.displayFinalPrice;
          result.displayDiscountPercentage = 0;
      }
  }

  if (product.discountPrice !== undefined && product.discountPrice > 0) {
    const c = convert(product.discountPrice);
    result.discountPrice = c.priceConverted;
    result.discountPriceDisplay = c.priceDisplay;
  }

  if (product.price !== undefined) {
    result.price = convert(product.price).priceConverted;
  }

  // 2. Nested fields (simple)
  if (product.simple) {
    const s = { ...product.simple };
    if (s.finalPrice !== undefined) s.finalPrice = convert(s.finalPrice).priceConverted;
    if (s.merchantPrice !== undefined) s.merchantPrice = convert(s.merchantPrice).priceConverted;
    if (s.discountPrice !== undefined && s.discountPrice > 0) s.discountPrice = convert(s.discountPrice).priceConverted;
    result.simple = s;
  }

  // 3. Nested fields (productLevelPricing)
  if (product.productLevelPricing) {
    const plp = { ...product.productLevelPricing };
    if (plp.finalPrice !== undefined) plp.finalPrice = convert(plp.finalPrice).priceConverted;
    if (plp.merchantPrice !== undefined) plp.merchantPrice = convert(plp.merchantPrice).priceConverted;
    if (plp.discountPrice !== undefined && plp.discountPrice > 0) plp.discountPrice = convert(plp.discountPrice).priceConverted;
    result.productLevelPricing = plp;
  }

  // 4. Handle variants
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    result.variants = product.variants.map((v) => {
      const vr = { ...v };
      if (v.finalPrice !== undefined) {
        const c = convert(v.finalPrice);
        vr.finalPrice = c.priceConverted;
        vr.priceConverted = c.priceConverted;
        vr.priceDisplay = c.priceDisplay;
      }
      if (v.merchantPrice !== undefined) vr.merchantPrice = convert(v.merchantPrice).priceConverted;
      if (v.discountPrice !== undefined && v.discountPrice > 0) vr.discountPrice = convert(v.discountPrice).priceConverted;
      return vr;
    });
  }

  return result;
}

/**
 * Get FX snapshot for order creation
 * @param {string} currencyCode
 * @returns {Promise<Object>} - FX snapshot object for Order schema
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
