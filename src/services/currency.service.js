import logger from "../lib/logger.js";
import Currency from "../models/currency.model.js";
import ExchangeRate from "../models/exchangeRate.model.js";
import { ServiceError } from "../lib/errors.js";
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
 * Resolve the { config, rate } pair needed to convert into `currencyCode`,
 * fetching each at most once. The result is shaped to be passed straight back
 * in as the `context` argument of `convertProductPrices`, so a single request
 * never hits Currency / ExchangeRate twice.
 *
 * For USD we deliberately return the *default* config rather than the DB row:
 * the seeded USD document carries `roundingStrategy: "ENDING_9"`, and product
 * payloads have never had that applied (convertProductPrices only loads a DB
 * config when the code isn't USD). Loading it here would silently start
 * re-pricing every USD amount that flows through these helpers.
 */
export async function getCurrencyContext(currencyCode) {
  const upperCode = currencyCode?.toUpperCase() || "USD";

  if (upperCode === "USD") {
    return { upperCode, config: getDefaultCurrencyConfig("USD"), rate: null };
  }

  const [config, rate] = await Promise.all([
    Currency.findOne({ code: upperCode }).lean(),
    getLatestRate(upperCode),
  ]);

  return { upperCode, config: config || getDefaultCurrencyConfig(upperCode), rate };
}

/**
 * Convert one USD scalar into the context's currency.
 *
 * Always use this instead of the `applyPsychologicalPricing(usd * rate)`
 * shortcut: that shortcut skips `marketMarkupAdjustment`, which
 * convertAndFormatPriceSync applies *before* rounding. Any surface that takes
 * the shortcut reports a number below what the shopper was actually charged
 * the moment a market markup is configured.
 */
export function convertAmount(amountUSD, context) {
  const { upperCode, config, rate } = context || {};
  return convertAndFormatPriceSync(amountUSD, upperCode, rate, config).priceConverted;
}

/**
 * Convert order / quote lines into the context's currency.
 *
 * Rounding happens PER UNIT and quantities multiply afterwards — the same order
 * of operations `convertProductPrices` uses, since it converts each unit price
 * individually. Converting the aggregate instead yields a total that disagrees
 * with the line items the shopper is looking at: under SDG's NEAREST_10
 * strategy `round10(unit) * qty` and `round10(unit * qty)` drift by up to 5 per
 * unit. Every surface that reports a converted order total must come through
 * here, or the checkout screen and the stored order will disagree again.
 *
 * @param {Array<{unitPrice:number, quantity:number}>} lines - USD unit prices
 * @param {Object} context - from getCurrencyContext()
 */
export function convertLineTotals(lines, context) {
  const cache = new Map();
  const convert = (usd) => {
    if (cache.has(usd)) return cache.get(usd);
    const converted = convertAmount(usd, context);
    cache.set(usd, converted);
    return converted;
  };

  let total = 0;
  const converted = (lines || []).map((line) => {
    const quantity = Number(line?.quantity) || 0;
    const unitPrice = convert(Number(line?.unitPrice) || 0);
    const lineTotal = unitPrice * quantity;
    total += lineTotal;
    return { ...line, unitPrice, lineTotal };
  });

  return { lines: converted, total };
}

/** Plain decimal rounding to a currency's precision. */
function roundTo(amount, decimals = 2) {
  const d = Math.max(0, Number(decimals) || 0);
  const f = 10 ** d;
  return Math.round(((Number(amount) || 0) + Number.EPSILON) * f) / f;
}

/**
 * Convert a USD amount for use as a REFERENCE price (strikethrough / MSRP).
 *
 * Identical to convertAndFormatPriceSync — FX rate, then
 * `marketMarkupAdjustment` — EXCEPT the last step is a plain round to the
 * currency's decimals instead of applyPsychologicalPricing.
 *
 * Psychological pricing exists to make the price the shopper PAYS attractive.
 * A strikethrough is a reference number, not a price on sale, so there is no
 * reason to snap it to the same coarse grid — and doing so is what made the
 * pair collide (see convertedPricePair below).
 */
function convertReferenceSync(amountUSD, currencyCode, rateInfo, currencyConfig) {
  const upperCode = currencyCode?.toUpperCase() || "USD";
  const config = currencyConfig || getDefaultCurrencyConfig(upperCode);

  let amount = Number(amountUSD) || 0;
  let rate = 1;
  let rateUnavailable = false;

  if (upperCode !== "USD") {
    if (!rateInfo || rateInfo.rateUnavailable || rateInfo.rate === null) {
      rateUnavailable = true;
    } else {
      rate = rateInfo.rate;
      amount = amount * rate;
    }
  }

  if (!rateUnavailable) {
    const markup = config.marketMarkupAdjustment || 0;
    if (markup !== 0) amount += (amount * markup) / 100;
    amount = roundTo(amount, config.decimals ?? 2);
  }

  return {
    priceConverted: amount,
    priceDisplay: formatPrice(amount, config),
    currencyCode: upperCode,
    rate,
    rateDate: rateInfo?.date,
    rateProvider: rateInfo?.provider,
    rateUnavailable,
  };
}

/**
 * Produce the CONSISTENT converted { original, discountAmount } pair for a
 * product or variant (PRICING_AUDIT_REPORT Issue #9).
 *
 * ── The problem ────────────────────────────────────────────────────────────
 * applyPsychologicalPricing runs per amount. Rounding `finalPrice` and
 * `originalPrice` through it independently can collapse a real discount to the
 * SAME converted value, or invert the pair, so a client comparing the two
 * numbers silently drops the strikethrough.
 *
 * ── What we must never do ──────────────────────────────────────────────────
 * The obvious fix — `original = final + convert(discountAmount)` — runs the
 * DISCOUNT through psychological rounding too, which INFLATES it (a $26
 * discount becomes 29.99 under ENDING_9). Overstating a saving is an
 * advertising claim about money, not a cosmetic bug. A missing strikethrough
 * is strictly preferable.
 *
 * ── The rules this function guarantees ─────────────────────────────────────
 *   1. The displayed saving NEVER exceeds the true converted discount.
 *      Understating is acceptable; overstating is not.
 *   2. `convertedFinal + discountAmount === convertedOriginal` exactly —
 *      discountAmount is DERIVED from the rounded pair, never rounded
 *      independently.
 *   3. `convertedOriginal >= convertedFinal` always. When rounding collapses
 *      or inverts the pair we return original === final and discountAmount
 *      === 0. We never fabricate a larger original to force a visible
 *      strikethrough.
 *
 * `final` keeps full psychological rounding (it is the price being sold);
 * `original` uses convertReferenceSync (plain decimal rounding). The gap is
 * then clamped to the true converted discount, because a psychological rule
 * that rounds `final` DOWN (e.g. NEAREST_10 on 104 → 100) would otherwise
 * widen the apparent saving beyond the real one.
 *
 * ── DISPLAY CONTRACT for client authors ────────────────────────────────────
 *   • Render the strikethrough IFF `original > final` (equivalently
 *     `discountAmount > 0`). Never key it on `hasDiscount`: in the collapse
 *     case hasDiscount is legitimately true while original === final, and
 *     keying on it renders a degenerate strikethrough equal to the price.
 *   • Render the discount BADGE iff `discountPercentage > 0`. That value is
 *     currency-invariant truth from the pricing engine and stays correct even
 *     when the converted money pair has collapsed.
 *
 * NOTE: this deliberately does NOT touch convertAmount / convertLineTotals —
 * order and checkout surfaces round per unit then multiply, and that contract
 * is load-bearing (see the comments on those functions).
 *
 * @param {object} source  product or variant carrying USD amounts
 * @param {Function} convert  memoized convertAndFormatPriceSync wrapper (final)
 * @param {Function} convertReference  memoized convertReferenceSync wrapper
 * @param {number} decimals  target currency decimals
 * @returns {{original: number|undefined, discountAmount: number|undefined}}
 */
function convertedPricePair(source, convert, convertReference, decimals = 2) {
  const originalUSD = source?.originalPrice;
  if (originalUSD === undefined || originalUSD === null) {
    return { original: undefined, discountAmount: undefined };
  }

  const finalUSD = source?.finalPrice;
  // No final price to anchor against — convert as a plain reference price.
  if (finalUSD === undefined || finalUSD === null) {
    return {
      original: convertReference(originalUSD)?.priceConverted,
      discountAmount: undefined,
    };
  }

  const convertedFinal = convert(finalUSD)?.priceConverted ?? 0;
  const referenceOriginal = convertReference(originalUSD)?.priceConverted ?? convertedFinal;

  // The true discount in this currency: rate + market markup, plainly rounded.
  // Never psychological-rounded — that is what inflated the saving.
  const discountUSD =
    source?.discountAmount !== undefined && source?.discountAmount !== null
      ? Math.max(0, Number(source.discountAmount) || 0)
      : Math.max(0, (Number(originalUSD) || 0) - (Number(finalUSD) || 0));
  const trueDiscount = discountUSD > 0
    ? Math.max(0, convertReference(discountUSD)?.priceConverted ?? 0)
    : 0;

  // Rule 1 + rule 3: clamp the gap to [0, trueDiscount].
  const gap = roundTo(referenceOriginal - convertedFinal, decimals);
  const discountAmount = Math.max(0, Math.min(gap, trueDiscount));

  // Rule 2: original is defined AS final + discountAmount, so the identity is
  // exact by construction rather than by luck. The Math.max is belt-and-braces
  // for rule 3 — with a `convert` that normalizes to `decimals` it can never
  // bind, but it makes the invariant hold unconditionally.
  return {
    original: Math.max(convertedFinal, roundTo(convertedFinal + discountAmount, decimals)),
    discountAmount: roundTo(discountAmount, decimals),
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

  const decimals = config?.decimals ?? 2;

  // ✅ MEMOIZATION (performance boost)
  const cache = new Map();

  const convert = (val) => {
    if (val === undefined || val === null) return val;
    if (cache.has(val)) return cache.get(val);

    const raw = convertAndFormatPriceSync(val, upperCode, rate, config);
    // Psychological strategies emit sub-minor-unit float noise — ENDING_9
    // returns `floored + 0.99` which is 29.990000000000002, not 29.99. Left
    // alone that noise makes `original >= final` fail by ~3e-15 in the
    // collapse case and breaks the exact identity in convertedPricePair.
    // Normalizing to the currency's precision changes no displayed value
    // (both format to "29.99") and makes downstream arithmetic exact.
    // NOTE: scoped to this function's payload only — convertAmount /
    // convertLineTotals call convertAndFormatPriceSync directly and are
    // deliberately untouched.
    const result = { ...raw, priceConverted: roundTo(raw.priceConverted, decimals) };
    cache.set(val, result);
    return result;
  };

  // Reference conversions (strikethrough / discount amounts) skip
  // psychological rounding — see convertReferenceSync and convertedPricePair.
  const referenceCache = new Map();
  const convertReference = (val) => {
    if (val === undefined || val === null) return val;
    if (referenceCache.has(val)) return referenceCache.get(val);

    const result = convertReferenceSync(val, upperCode, rate, config);
    referenceCache.set(val, result);
    return result;
  };

  const result = { ...product };

  // ROOT
  if (product.finalPrice !== undefined) {
    const c = convert(product.finalPrice);
    result.finalPrice = c.priceConverted;
    result.priceDisplay = c.priceDisplay;
  }

  // The strikethrough and the saving are produced together so they cannot
  // disagree — see convertedPricePair (Issue #9).
  const rootPair = convertedPricePair(product, convert, convertReference, decimals);

  if (product.originalPrice !== undefined) {
    result.originalPrice = rootPair.original;
  }

  if (product.discountPrice > 0) {
    const c = convert(product.discountPrice);
    result.discountPrice = c.priceConverted;
    result.discountPriceDisplay = c.priceDisplay;
  }

  // Root discountAmount / listPrice were previously left in USD while every
  // field around them (and the `price` envelope) was converted, so the flat
  // aliases and the envelope disagreed in any non-USD currency.
  // See PRICING_AUDIT_REPORT Issue #18.
  //
  // discountAmount is the DERIVED saving (original − final), never the
  // independently rounded discount, so `final + discountAmount === original`
  // holds exactly and the displayed saving can never exceed the real one.
  if (product.discountAmount !== undefined) {
    result.discountAmount = rootPair.discountAmount !== undefined
      ? rootPair.discountAmount
      : convertReference(product.discountAmount).priceConverted;
  }
  // listPrice is a reference price (MSRP), not a price being sold.
  if (product.listPrice !== undefined) {
    result.listPrice = convertReference(product.listPrice).priceConverted;
  }

  // Currency-INVARIANT fields. The engine computes these correctly in USD and
  // a percentage / boolean does not change under an FX rate, so they pass
  // through untouched (Issue #9). Assigned explicitly so a future refactor of
  // the spread above can't quietly start rewriting them.
  //
  // DISPLAY CONTRACT (see convertedPricePair): the BADGE is driven by
  // `discountPercentage > 0`; the STRIKETHROUGH is driven by the money pair
  // (`originalPrice > finalPrice`), NOT by `hasDiscount`. In a currency whose
  // rounding collapses the pair, hasDiscount stays true while original ===
  // final — gating the strikethrough on it would render a strikethrough equal
  // to the price.
  if (product.hasDiscount !== undefined) {
    result.hasDiscount = !!product.hasDiscount;
  }
  if (product.discountPercentage !== undefined) {
    result.discountPercentage = product.discountPercentage;
  }
  if (product.displayDiscountPercentage !== undefined) {
    result.displayDiscountPercentage = product.displayDiscountPercentage;
  }

  // displayFinalPrice / displayOriginalPrice are aliases written by
  // enrichProductWithPricing — keep them in lockstep with the converted values
  // so any consumer that reads the alias still sees the user's currency.
  if (product.displayFinalPrice !== undefined) {
    result.displayFinalPrice = convert(product.displayFinalPrice).priceConverted;
  }
  if (product.displayOriginalPrice !== undefined) {
    result.displayOriginalPrice = convertedPricePair(
      {
        originalPrice:  product.displayOriginalPrice,
        finalPrice:     product.displayFinalPrice ?? product.finalPrice,
        discountAmount: product.discountAmount,
      },
      convert,
      convertReference,
      decimals,
    ).original;
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
      // Strikethrough + saving produced together — see convertedPricePair (Issue #9).
      const vPair = convertedPricePair(v, convert, convertReference, decimals);
      if (v.originalPrice !== undefined) {
        vr.originalPrice = vPair.original;
      }
      if (v.listPrice !== undefined) {
        vr.listPrice = convertReference(v.listPrice).priceConverted;
      }
      if (v.discountAmount !== undefined) {
        vr.discountAmount = vPair.discountAmount !== undefined
          ? vPair.discountAmount
          : convertReference(v.discountAmount).priceConverted;
      }
      // Currency-invariant — carried through untouched (see root block).
      if (v.hasDiscount !== undefined) {
        vr.hasDiscount = !!v.hasDiscount;
      }
      if (v.discountPercentage !== undefined) {
        vr.discountPercentage = v.discountPercentage;
      }
      if (v.displayDiscountPercentage !== undefined) {
        vr.displayDiscountPercentage = v.displayDiscountPercentage;
      }
      if (v.displayFinalPrice !== undefined) {
        vr.displayFinalPrice = convert(v.displayFinalPrice).priceConverted;
      }
      if (v.displayOriginalPrice !== undefined) {
        vr.displayOriginalPrice = convertedPricePair(
          {
            originalPrice:  v.displayOriginalPrice,
            finalPrice:     v.displayFinalPrice ?? v.finalPrice,
            discountAmount: v.discountAmount,
          },
          convert,
          convertReference,
          decimals,
        ).original;
      }
      vr.price = buildPriceEnvelope(v, convert, convertReference, config);
      return vr;
    });
  }

  // Typed Money envelope — the new canonical price surface.
  // Existing aliases (finalPrice/originalPrice/displayFinalPrice/...) stay
  // in place so legacy consumers keep working during migration.
  result.price = buildPriceEnvelope(product, convert, convertReference, config);
  result.currency = {
    code: upperCode,
    symbol: config.symbol,
    decimals: config.decimals ?? 2,
    symbolPosition: config.symbolPosition || "before",
  };

  return result;
}

/**
 * Build the canonical { final, original, list, discount } Money envelope
 * for a product or variant. `convert(usdAmount)` returns the memoized
 * convertAndFormatPriceSync result (psychological rounding — prices being
 * sold); `convertReference(usdAmount)` the memoized convertReferenceSync
 * result (plain rounding — reference amounts). Pass undefined for fields that
 * don't exist on the source object.
 *
 * DISPLAY CONTRACT: strikethrough iff `original.amount > final.amount`
 * (equivalently `discountAmount.amount > 0`); badge iff
 * `discountPercentage > 0`. Do NOT gate the strikethrough on `hasDiscount` —
 * see convertedPricePair.
 */
function buildPriceEnvelope(source, convert, convertReference, config) {
  const decimals = config?.decimals ?? 2;

  const money = (c, amountOverride) => {
    if (!c) return undefined;
    const amount = amountOverride === undefined ? c.priceConverted : amountOverride;
    return {
      amount,
      currency: c.currencyCode,
      formatted: amountOverride === undefined ? c.priceDisplay : formatPrice(amount, config),
      decimals,
      rate: c.rate,
      rateProvider: c.rateProvider,
      rateDate: c.rateDate,
      rateUnavailable: c.rateUnavailable,
    };
  };

  const toMoney = (usd) =>
    usd === undefined || usd === null ? undefined : money(convert(usd));

  // `original` and `discountAmount` come from the SAME clamped pair, so
  // `final + discountAmount === original` holds exactly inside this envelope
  // in every currency, and the saving never overstates the real one.
  // Meta (rate/provider/date) is reused from the anchor conversion.
  const pair = convertedPricePair(source, convert, convertReference, decimals);
  const meta = convert(source.finalPrice ?? source.originalPrice);

  const originalMoney =
    pair.original === undefined || pair.original === null
      ? undefined
      : money(meta, pair.original);

  const discountMoney =
    source.discountAmount === undefined || source.discountAmount === null
      ? undefined
      : money(
          meta,
          pair.discountAmount !== undefined
            ? pair.discountAmount
            : convertReference(source.discountAmount)?.priceConverted,
        );

  return {
    final:    toMoney(source.finalPrice),
    original: originalMoney,
    // listPrice is a reference (MSRP) amount — plainly rounded, not snapped.
    list: source.listPrice === undefined || source.listPrice === null
      ? undefined
      : money(convertReference(source.listPrice)),
    // Currency-invariant — never recomputed from converted amounts.
    discountPercentage: Number(source.discountPercentage) || 0,
    discountAmount: discountMoney,
    hasDiscount: !!source.hasDiscount,
  };
}

/* ============================================================================
   INPUT conversion — merchant's currency → USD (the WRITE path)
   ----------------------------------------------------------------------------
   Everything above this line is the READ path: USD leaves the database and is
   dressed up for a shopper. This section is the opposite direction, and the two
   must not be confused.

   THE RULE THAT MATTERS: the write path applies the FX rate and NOTHING ELSE.
   No `marketMarkupAdjustment`, no `roundingStrategy`. Those exist to make the
   price a shopper PAYS attractive and market-appropriate; they are applied on
   the way out, every time a product is served. Applying them on the way in
   would bake a second market markup into the stored cost (which then gets
   marked up again on read) and would psychologically round a merchant's COST —
   a number that is not for sale and that the merchant expects to see back
   unchanged. Do not "reuse convertAndFormatPriceSync with an inverted rate".
   ========================================================================== */

/** Mirrors variantSchema.merchantPrice `min: 1` (models/product.model.js). */
export const MIN_MERCHANT_PRICE_USD = 1;

/**
 * PURE inverse conversion. Exported for tests and for callers converting a
 * whole product, who must pass ONE rate through every money field so a price
 * and its discount can't be struck at two different rates.
 *
 * `rate` is USD→currency — the direction fx.service publishes — so going back
 * to USD is a division. A single division rounded once at the end is the whole
 * operation: any intermediate rounding would only add error.
 *
 * @param {number} amount  merchant-entered amount, in `rate`'s currency
 * @param {number} rate    USD→currency rate (e.g. 3.75 for SAR)
 * @returns {number} USD, rounded to cents
 */
export function usdFromRate(amount, rate) {
  return roundTo((Number(amount) || 0) / rate, 2);
}

/**
 * Resolve the { currency, rate } pair a merchant-entered price needs, fetching
 * each at most once. Shaped to be reused across every field of one product.
 *
 * Throws rather than degrading: see convertToUSD.
 */
export async function getInputCurrencyContext(currencyCode) {
  const upperCode = String(currencyCode || "USD").trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(upperCode)) {
    throw new ServiceError(
      `"${currencyCode}" is not a valid ISO 4217 currency code`,
      "INVALID_CURRENCY_CODE",
      400,
    );
  }

  if (upperCode === "USD") {
    return {
      code: "USD",
      rate: 1,
      rateDate: new Date().toISOString().split("T")[0],
      provider: "system",
      decimals: 2,
      symbol: "$",
    };
  }

  const [currency, rateInfo] = await Promise.all([
    Currency.findOne({ code: upperCode }).lean(),
    getLatestRate(upperCode),
  ]);

  // An unknown or switched-off currency is a configuration answer, not a
  // pricing one — never guess a rate for it.
  if (!currency || !currency.isActive) {
    throw new ServiceError(
      `${upperCode} is not enabled for price entry`,
      "CURRENCY_NOT_AVAILABLE",
      400,
    );
  }

  // THE CATASTROPHIC CASE. The read path answers "no rate" with rate = 1 and a
  // `rateUnavailable` flag, which is survivable when displaying a price — the
  // shopper sees dollars labelled oddly. On the WRITE path a 1:1 fallback would
  // store 60,000 SDG as $60,000 and the merchant would never be told. Most of
  // the currencies this feature exists for (SAR, AED, EGP, SDG, QAR, KWD) are
  // NOT published by Frankfurter/ECB — see fx.service.js SUPPORTED_SYMBOLS —
  // so they reach here with a rate ONLY if an admin set `allowManualRate` +
  // `manualRate` in /admin/currencies. Refusing is the correct answer.
  if (rateInfo?.rateUnavailable || !(Number(rateInfo?.rate) > 0)) {
    throw new ServiceError(
      `No exchange rate is available for ${upperCode}, so a price entered in it ` +
        `cannot be converted. An admin must set a manual rate for ${upperCode} first.`,
      "RATE_UNAVAILABLE",
      422,
    );
  }

  return {
    code: upperCode,
    rate: Number(rateInfo.rate),
    rateDate: rateInfo.date || null,
    provider: rateInfo.provider || "unknown",
    decimals: currency.decimals ?? 2,
    symbol: currency.symbol || upperCode,
  };
}

/**
 * Convert ONE merchant-entered amount into the USD the platform stores.
 *
 * Returns the audit block that belongs alongside the stored dollars — the rate
 * actually used, its date and provider — so a price can always be explained
 * later, and so a merchant editing the product can be shown the number they
 * originally typed instead of a re-converted approximation that drifts.
 *
 * NOTE ON STALENESS: this deliberately does NOT reject an old rate. The
 * currencies this feature is for are the manual-rate ones, and a manual rate's
 * date is simply whenever an admin last touched it — an age check would make
 * the feature unusable for exactly the Gulf/Sudan markets it exists to serve.
 * `rateDate` and `rateAgeDays` are returned instead so the caller can warn.
 *
 * @param {number} amount        merchant-entered amount
 * @param {string} currencyCode  what the merchant typed it in
 * @param {object} [context]     from getInputCurrencyContext(), to reuse a rate
 * @returns {Promise<{amountUSD:number, currency:string, amount:number,
 *                    rate:number, rateDate:string|null, provider:string}>}
 */
export async function convertToUSD(amount, currencyCode, context = null) {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new ServiceError(
      "Price must be a number greater than zero",
      "INVALID_AMOUNT",
      400,
    );
  }

  const ctx = context || (await getInputCurrencyContext(currencyCode));
  const amountUSD = usdFromRate(numericAmount, ctx.rate);

  // Below the schema floor the save would fail deep inside Mongoose with a
  // message about `variants.0.merchantPrice`, which tells a merchant nothing.
  // Explain it in the currency they actually typed.
  if (amountUSD < MIN_MERCHANT_PRICE_USD) {
    throw new ServiceError(
      `${numericAmount} ${ctx.code} converts to $${amountUSD.toFixed(2)}, below the ` +
        `$${MIN_MERCHANT_PRICE_USD.toFixed(2)} minimum price.`,
      "BELOW_MINIMUM_PRICE",
      400,
    );
  }

  return {
    amountUSD,
    currency: ctx.code,
    amount: numericAmount,
    rate: ctx.rate,
    rateDate: ctx.rateDate,
    provider: ctx.provider,
  };
}

/** Whole days between an ISO yyyy-mm-dd rate date and today; null if unknown. */
function rateAgeDays(rateDate) {
  if (!rateDate) return null;
  const then = Date.parse(`${rateDate}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/**
 * Currencies a merchant may actually type a price in: active AND holding a
 * usable rate right now.
 *
 * The intersection is the point. Listing an active currency with no rate would
 * put a choice in the picker that can only fail at save time — or worse, invite
 * the 1:1 fallback this module refuses to perform. USD is always eligible.
 *
 * Resolves every currency against ONE ExchangeRate document rather than calling
 * getLatestRate per code, which would re-read it for each.
 */
export async function listInputEligibleCurrencies() {
  const [currencies, latest] = await Promise.all([
    Currency.find({ isActive: true })
      .sort({ sortOrder: 1, code: 1 })
      .select("code name nameAr symbol symbolPosition decimals allowManualRate manualRate manualRateUpdatedAt")
      .lean(),
    ExchangeRate.getLatest(),
  ]);

  const eligible = [];

  for (const c of currencies) {
    if (c.code === "USD") continue; // appended below, always

    // Same precedence as getLatestRate: a manual rate overrides the feed.
    let rate = null;
    let date = null;
    let provider = null;

    if (c.allowManualRate && c.manualRate > 0) {
      rate = c.manualRate;
      date = c.manualRateUpdatedAt?.toISOString().split("T")[0] || null;
      provider = "manual";
    } else if (latest?.rates?.[c.code] > 0) {
      rate = latest.rates[c.code];
      date = latest.date || null;
      provider = latest.provider || "unknown";
    }

    if (!(rate > 0)) continue;

    eligible.push({
      code: c.code,
      name: c.name,
      nameAr: c.nameAr,
      symbol: c.symbol,
      symbolPosition: c.symbolPosition || "before",
      decimals: c.decimals ?? 2,
      rate,
      rateDate: date,
      rateProvider: provider,
      rateAgeDays: rateAgeDays(date),
    });
  }

  return [
    {
      code: "USD",
      name: "US Dollar",
      nameAr: "دولار أمريكي",
      symbol: "$",
      symbolPosition: "before",
      decimals: 2,
      rate: 1,
      rateDate: new Date().toISOString().split("T")[0],
      rateProvider: "system",
      rateAgeDays: 0,
    },
    ...eligible,
  ];
}

/**
 * FX Snapshot for orders
 */
export async function getFxSnapshotForOrder(currencyCode, context) {
  const upperCode = currencyCode?.toUpperCase() || "USD";
  // Reuse the caller's context when it has one so the rate we *store* on the
  // order is provably the same rate we *converted* with. (USD contexts carry a
  // null rate — fall through and let getLatestRate return the 1:1 stub.)
  const rateInfo = context?.rate ?? (await getLatestRate(upperCode));

  return {
    base: "USD",
    date: rateInfo.date || new Date().toISOString().split("T")[0],
    rate: rateInfo.rate || 1,
    provider: rateInfo.provider || "system",
  };
}