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
export async function convertAndFormatPrice(amountUSD, currencyCode) {
  const upperCode = currencyCode?.toUpperCase() || "USD";

  // Get currency config
  const currency = await Currency.findOne({ code: upperCode }).lean();
  const currencyConfig = currency || {
    code: upperCode,
    symbol: upperCode === "USD" ? "$" : upperCode,
    decimals: 2,
    roundingStrategy: "NONE",
    symbolPosition: "before",
    marketMarkupAdjustment: 0,
  };

  // Convert
  const conversion = await convertUSDToCurrency(amountUSD, upperCode);

  // Apply psychological pricing if rate is available
  let finalAmount = conversion.amountConverted;
  if (!conversion.rateUnavailable) {
    finalAmount = applyPsychologicalPricing(finalAmount, currencyConfig);
    
    // Apply market-specific markup adjustment (e.g., +5% for premium markets)
    const marketAdjustment = currencyConfig.marketMarkupAdjustment || 0;
    if (marketAdjustment !== 0) {
      const adjustmentAmount = (finalAmount * marketAdjustment) / 100;
      finalAmount = finalAmount + adjustmentAmount;
      // Re-apply psychological pricing after adjustment
      finalAmount = applyPsychologicalPricing(finalAmount, currencyConfig);
    }
  }

  // Format
  const priceDisplay = formatPrice(finalAmount, currencyConfig);

  return {
    priceUSD: amountUSD,
    priceConverted: finalAmount,
    priceDisplay,
    currencyCode: upperCode,
    symbol: currencyConfig.symbol,
    rate: conversion.rate,
    rateDate: conversion.date,
    rateProvider: conversion.provider,
    rateUnavailable: conversion.rateUnavailable,
    roundingStrategy: currencyConfig.roundingStrategy,
    marketMarkupAdjustment: currencyConfig.marketMarkupAdjustment || 0,
  };
}

/**
 * Convert multiple prices for a product
 * Handles finalPrice and any other pricing fields
 * @param {Object} product - Product with pricing fields
 * @param {string} currencyCode - Target currency
 * @returns {Promise<Object>} - Product with converted prices
 */
export async function convertProductPrices(product, currencyCode) {
  const result = { ...product };

  // 1. Root-level standard fields
  if (product.finalPrice !== undefined) {
    logger.info('Converting finalPrice', { 
      name: product.name, 
      original: product.finalPrice, 
      currencyCode 
    });
    const converted = await convertAndFormatPrice(product.finalPrice, currencyCode);
    result.finalPrice = converted.priceConverted; // Convert the numerical value
    result.priceConverted = converted.priceConverted; // Legacy/convenience
    result.priceDisplay = converted.priceDisplay;
    result.currencyCode = converted.currencyCode;
    result.rate = converted.rate;
    result.rateDate = converted.rateDate;
    result.rateUnavailable = converted.rateUnavailable;
    logger.info('Converted finalPrice', { 
      name: product.name, 
      converted: result.finalPrice, 
      display: result.priceDisplay 
    });
  }

  if (product.merchantPrice !== undefined) {
    const converted = await convertAndFormatPrice(product.merchantPrice, currencyCode);
    result.merchantPrice = converted.priceConverted;
    result.originalPrice = converted.priceConverted;
  }

  if (product.discountPrice !== undefined && product.discountPrice > 0) {
    const converted = await convertAndFormatPrice(product.discountPrice, currencyCode);
    result.discountPrice = converted.priceConverted;
    result.discountPriceDisplay = converted.priceDisplay;
  }

  if (product.price !== undefined) {
    const converted = await convertAndFormatPrice(product.price, currencyCode);
    result.price = converted.priceConverted;
  }

  // 2. Convered nested fields (simple)
  if (product.simple) {
    const simple = { ...product.simple };
    if (simple.finalPrice !== undefined) {
      const converted = await convertAndFormatPrice(simple.finalPrice, currencyCode);
      simple.finalPrice = converted.priceConverted;
    }
    if (simple.merchantPrice !== undefined) {
      const converted = await convertAndFormatPrice(simple.merchantPrice, currencyCode);
      simple.merchantPrice = converted.priceConverted;
    }
    if (simple.discountPrice !== undefined && simple.discountPrice > 0) {
      const converted = await convertAndFormatPrice(simple.discountPrice, currencyCode);
      simple.discountPrice = converted.priceConverted;
    }
    result.simple = simple;
  }

  // 3. Convert nested fields (productLevelPricing)
  if (product.productLevelPricing) {
    const plp = { ...product.productLevelPricing };
    if (plp.finalPrice !== undefined) {
      const converted = await convertAndFormatPrice(plp.finalPrice, currencyCode);
      plp.finalPrice = converted.priceConverted;
    }
    if (plp.merchantPrice !== undefined) {
      const converted = await convertAndFormatPrice(plp.merchantPrice, currencyCode);
      plp.merchantPrice = converted.priceConverted;
    }
    if (plp.discountPrice !== undefined && plp.discountPrice > 0) {
      const converted = await convertAndFormatPrice(plp.discountPrice, currencyCode);
      plp.discountPrice = converted.priceConverted;
    }
    result.productLevelPricing = plp;
  }

  // 4. Handle variants if present
  if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
    result.variants = await Promise.all(
      product.variants.map(async (variant) => {
        const variantResult = { ...variant };
        
        if (variant.finalPrice !== undefined) {
          const converted = await convertAndFormatPrice(variant.finalPrice, currencyCode);
          variantResult.finalPrice = converted.priceConverted;
          variantResult.priceConverted = converted.priceConverted; // Legacy
          variantResult.priceDisplay = converted.priceDisplay;
        }
        
        if (variant.merchantPrice !== undefined) {
          const converted = await convertAndFormatPrice(variant.merchantPrice, currencyCode);
          variantResult.merchantPrice = converted.priceConverted;
        }
        
        if (variant.discountPrice !== undefined && variant.discountPrice > 0) {
          const converted = await convertAndFormatPrice(variant.discountPrice, currencyCode);
          variantResult.discountPrice = converted.priceConverted;
        }

        return variantResult;
      })
    );
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
