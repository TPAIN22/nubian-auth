/**
 * Pricing Engine — single source of truth.
 *
 * Every place that needs a final selling price (model pre-save, dynamicPricing
 * cron, products controller, cart, order snapshot, currency conversion) must
 * route through `calculateFinalPrice` so the formula stays consistent.
 *
 * Formula:
 *   listed   = merchantPrice × (1 + nubianMarkup/100)              (MSRP)
 *   surged   = merchantPrice × (1 + nubianMarkup/100 + dynamicMarkup/100)
 *   final    = surged − variant.merchantDiscount − productDiscountApplied
 *
 *   originalPrice = max(listed, surged)  — strikethrough shown to the customer
 *   discountAmount = max(0, originalPrice − final)
 *
 * Discount precedence (largest scope wins, both can stack):
 *   1. variant.merchantDiscount  (absolute, per-variant override)
 *   2. product.discount          (percentage|fixed, applies to every variant)
 *
 * Floor: a variant is never sold below cost via dynamic markup alone. If a
 * merchant explicitly sets a discount, below-cost is allowed (minimum 1).
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Returns true if a product-level discount block is currently usable.
 * Mirrors coupon.isCurrentlyValid semantics so future flash-sales/coupons can reuse it.
 */
export function isProductDiscountActive(discount, now = new Date()) {
  if (!discount || !discount.isActive) return false;
  if (!(Number(discount.value) > 0)) return false;
  if (discount.type !== 'percentage' && discount.type !== 'fixed') return false;
  const t = now.getTime();
  if (discount.startsAt && new Date(discount.startsAt).getTime() > t) return false;
  if (discount.endsAt && new Date(discount.endsAt).getTime() < t) return false;
  return true;
}

/**
 * Compute the absolute discount amount a product-level offer takes off a price.
 * Returns 0 when the offer is not active, expired, or invalid.
 */
export function computeProductDiscountAmount(price, discount) {
  if (!isProductDiscountActive(discount)) return 0;
  const p = Math.max(0, Number(price) || 0);
  const v = Math.max(0, Number(discount.value) || 0);
  let amount = discount.type === 'percentage' ? (p * v) / 100 : v;
  if (discount.type === 'percentage' && discount.maxDiscount > 0) {
    amount = Math.min(amount, discount.maxDiscount);
  }
  return Math.min(amount, p);
}

/**
 * Compute final price for a single variant under a product context.
 * `product` may be null/undefined for orphan calls — defaults are then used.
 */
export function calculateFinalPrice({ product, variant }) {
  const v = variant || (Array.isArray(product?.variants) ? product.variants[0] : null);

  if (!v) {
    return {
      basePrice: 0,
      listPrice: 0,
      originalPrice: 0,
      finalPrice: 0,
      discountAmount: 0,
      discountPercentage: 0,
      hasDiscount: false,
      breakdown: {
        merchantPrice: 0, nubianMarkup: 0, dynamicMarkup: 0,
        variantDiscount: 0, productDiscount: 0,
      },
    };
  }

  const merchantPrice = Math.max(0, Number(v.merchantPrice) || 0);
  const nubianMarkup  = Math.max(0, Number(v.nubianMarkup ?? 30));
  const allowDynamic  = product?.dynamicPricingEnabled !== false;
  const dynamicMarkup = allowDynamic ? Number(v.dynamicMarkup || 0) : 0;

  const listed = round2(merchantPrice * (1 + nubianMarkup / 100));
  const surged = round2(
    merchantPrice
    + (merchantPrice * nubianMarkup / 100)
    + (merchantPrice * dynamicMarkup / 100)
  );

  // Apply discounts on top of the surged price.
  const variantDiscount  = Math.max(0, Number(v.merchantDiscount) || 0);
  const productDiscount  = computeProductDiscountAmount(surged, product?.discount);
  const totalDiscount    = variantDiscount + productDiscount;

  // Floor: only protect cost when nothing was explicitly discounted by humans.
  // (A negative dynamicMarkup alone shouldn't push us below cost.)
  let final = round2(surged - totalDiscount);
  if (final < merchantPrice && totalDiscount === 0) final = merchantPrice;
  if (final < 1) final = 1;

  // Original = strikethrough we show to the customer.
  // When surged > listed (positive dynamicMarkup), surge becomes the new "original"
  // so a discount % off surge is honest; when surged ≤ listed, listed is original.
  const originalPrice = round2(Math.max(listed, surged));
  const discountAmount = originalPrice > final ? round2(originalPrice - final) : 0;
  const discountPercentage = originalPrice > 0 && discountAmount > 0
    ? Math.round((discountAmount / originalPrice) * 100)
    : 0;

  return {
    basePrice: merchantPrice,
    listPrice: listed,
    originalPrice,
    finalPrice: final,
    discountAmount,
    discountPercentage,
    hasDiscount: discountAmount > 0,
    breakdown: {
      merchantPrice,
      nubianMarkup,
      dynamicMarkup,
      variantDiscount,
      productDiscount: round2(productDiscount),
    },
  };
}

/**
 * Apply the engine across every variant of a product and pick the
 * representative one (lowest finalPrice among active variants) for
 * the root "From" price.
 */
export function calculateProductPricing(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length === 0) {
    return { variants: [], root: calculateFinalPrice({ product, variant: null }) };
  }

  const enrichedVariants = variants.map((variant) => ({
    variant,
    pricing: calculateFinalPrice({ product, variant }),
  }));

  const active = enrichedVariants.filter(({ variant }) => variant.isActive !== false);
  const pool = active.length > 0 ? active : enrichedVariants;
  const cheapest = pool.reduce((best, cur) =>
    !best || cur.pricing.finalPrice < best.pricing.finalPrice ? cur : best
  , null);

  return {
    variants: enrichedVariants,
    root: cheapest ? cheapest.pricing : enrichedVariants[0].pricing,
  };
}
