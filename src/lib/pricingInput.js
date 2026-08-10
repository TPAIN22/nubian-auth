import { ServiceError } from './errors.js';
import { usdFromRate, MIN_MERCHANT_PRICE_USD } from '../services/currency.service.js';

/**
 * Rewrite a product write payload whose money fields are denominated in the
 * merchant's currency into one denominated in USD, stamping the audit record
 * that says what was typed and at what rate.
 *
 * PURE — the caller resolves the currency context (a DB round trip) and passes
 * it in. That is not just for testability: taking ONE context means every money
 * field on the product is struck at the SAME rate. Resolving per field would
 * let a price and its discount land on either side of a rate refresh, and the
 * discount would then not be the amount the merchant chose.
 *
 * ── What is money and what is not ──────────────────────────────────────────
 * Converted:      variant.merchantPrice, variant.merchantDiscount,
 *                 discount.value WHEN discount.type === 'fixed',
 *                 discount.maxDiscount (a cap expressed in money)
 * NOT converted:  discount.value when type === 'percentage' — a percentage is
 *                 dimensionless. Converting it would turn 20% off into 75% off
 *                 in SAR, which is a real discount the merchant never authored.
 *                 nubianMarkup / dynamicMarkup, same reason.
 *
 * @param {object} body     the product create/update payload (mutated in place)
 * @param {object} context  from currency.service getInputCurrencyContext()
 * @returns {object} the same body
 */
export function applyPricingCurrency(body, context) {
  if (!body || !context) return body;

  const { code, rate, rateDate, provider } = context;

  // USD in, USD out — nothing to convert, and stamping an audit block for a
  // 1:1 "conversion" would only add noise to every product ever created.
  if (code === 'USD') return body;

  if (!(Number(rate) > 0)) {
    throw new ServiceError(
      `No usable exchange rate for ${code}`,
      'RATE_UNAVAILABLE',
      422,
    );
  }

  const lockedAt = new Date();

  if (Array.isArray(body.variants)) {
    body.variants = body.variants.map((variant) => convertVariant(variant, context));
  }

  // Product-level discount. sanitizeDiscountInput has NOT run yet at this point
  // (the controller sanitizes after converting), so treat the shape defensively.
  let discountValue = null;
  let discountMaxDiscount = null;

  if (body.discount && typeof body.discount === 'object') {
    const d = body.discount;

    // Only a fixed discount is money. A percentage must pass through untouched.
    if (d.type === 'fixed' && Number(d.value) > 0) {
      discountValue = Number(d.value);
      d.value = usdFromRate(discountValue, rate);
    }

    if (Number(d.maxDiscount) > 0) {
      discountMaxDiscount = Number(d.maxDiscount);
      d.maxDiscount = usdFromRate(discountMaxDiscount, rate);
    }
  }

  body.pricingInput = {
    currency: code,
    rate,
    rateDate: rateDate ?? null,
    provider: provider ?? null,
    lockedAt,
    discountValue,
    discountMaxDiscount,
  };

  return body;
}

/**
 * Blank the audit blocks, for a product being (re-)priced in plain USD.
 *
 * Needed because applyPricingCurrency returns early for USD without writing
 * anything: a product previously saved in SAR would otherwise keep its stale
 * SAR block, and the edit screen would confidently show the merchant a number
 * in a currency they are no longer using.
 */
export function clearPricingInput(body) {
  if (!body) return body;

  body.pricingInput = {
    currency: null,
    rate: null,
    rateDate: null,
    provider: null,
    lockedAt: null,
    discountValue: null,
    discountMaxDiscount: null,
  };

  if (Array.isArray(body.variants)) {
    body.variants = body.variants.map((v) =>
      v && typeof v === 'object'
        ? { ...v, pricingInput: { merchantPrice: null, merchantDiscount: null } }
        : v,
    );
  }

  return body;
}

/**
 * One variant's money fields, converted, with the typed originals preserved.
 */
function convertVariant(variant, context) {
  if (!variant || typeof variant !== 'object') return variant;

  const { code, rate } = context;
  const typedPrice = Number(variant.merchantPrice);

  if (!Number.isFinite(typedPrice) || typedPrice <= 0) {
    throw new ServiceError(
      `Variant ${variant.sku || '(no SKU)'}: price must be a number greater than zero`,
      'INVALID_AMOUNT',
      400,
      [{ field: 'merchantPrice', sku: variant.sku ?? null }],
    );
  }

  const merchantPrice = usdFromRate(typedPrice, rate);

  // Same floor convertToUSD enforces, reported per variant so the dashboard can
  // point at the offending row rather than failing the whole product opaquely.
  if (merchantPrice < MIN_MERCHANT_PRICE_USD) {
    throw new ServiceError(
      `Variant ${variant.sku || '(no SKU)'}: ${typedPrice} ${code} converts to ` +
        `$${merchantPrice.toFixed(2)}, below the $${MIN_MERCHANT_PRICE_USD.toFixed(2)} minimum price.`,
      'BELOW_MINIMUM_PRICE',
      400,
      [{ field: 'merchantPrice', sku: variant.sku ?? null }],
    );
  }

  const typedDiscount = Number(variant.merchantDiscount);
  const hasDiscount = Number.isFinite(typedDiscount) && typedDiscount > 0;

  return {
    ...variant,
    merchantPrice,
    merchantDiscount: hasDiscount ? usdFromRate(typedDiscount, rate) : (variant.merchantDiscount ?? 0),
    pricingInput: {
      merchantPrice: typedPrice,
      merchantDiscount: hasDiscount ? typedDiscount : null,
    },
  };
}
