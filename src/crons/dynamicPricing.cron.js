/**
 * Dynamic Pricing Cron
 *
 * Runs hourly. For each active product it:
 *   1. Reads 24h demand signals from product.trackingFields
 *   2. Computes a new dynamicMarkup using the scarcity + demand formula
 *   3. Computes the resulting finalPrice for each variant
 *   4. Writes only changed values via updateOne (no pre-save re-trigger)
 *
 * Formula:
 *   dynamicMarkup = clamp(scarcityBoost + demandBoost, -20, +50)
 *
 * Scarcity (stock-based — symmetric: low stock raises price, glut lowers it):
 *   stock = 0        → +30%  (sold-out effect / extreme scarcity)
 *   stock ≤ 5        → +20%
 *   stock ≤ 20       → +12%
 *   stock ≤ 50       → +5%
 *   stock ≤ 100      →  0%   (neutral zone)
 *   stock ≤ 200      → -5%   (high supply discount)
 *   stock > 200      → -10%  (overstock clearance)
 *
 * Demand (24h signal score = views + cartAdds×3 + sales×8):
 *   score ≥ 200      → +20%
 *   score ≥ 100      → +12%
 *   score ≥ 50       → +6%
 *   score < 50       →  0%
 *
 * Final price:
 *   finalPrice = merchantPrice × (1 + nubianMarkup/100 + dynamicMarkup/100) − merchantDiscount
 *   Clamped to: max(1, merchantPrice)  — never sell below cost
 */

import Product from '../models/product.model.js';
import logger from '../lib/logger.js';
import { calculateFinalPrice } from '../lib/pricing.engine.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute the final sale price from raw components.
 * Thin wrapper around the pricing engine so external callers keep the same API.
 */
export function computeFinalPrice({
  merchantPrice,
  nubianMarkup = 30,
  dynamicMarkup = 0,
  merchantDiscount = 0,
  product = null,
}) {
  if (!(Number(merchantPrice) > 0)) return 0;
  const { finalPrice } = calculateFinalPrice({
    product,
    variant: { merchantPrice, nubianMarkup, dynamicMarkup, merchantDiscount },
  });
  return finalPrice;
}

/**
 * Derive dynamic markup percentage from real-time signals.
 *
 * @param {object} params
 * @param {number} params.stock - Current variant stock units
 * @param {number} params.views24h - Page views in last 24h
 * @param {number} params.cartCount24h - Cart-add events in last 24h
 * @param {number} params.sales24h - Confirmed orders in last 24h
 * @returns {number} markup % in range [-20, 50]
 */
export function computeDynamicMarkup({ stock, views24h = 0, cartCount24h = 0, sales24h = 0 }) {
  const s = Math.max(0, Number(stock) || 0);
  const v = Number(views24h) || 0;
  const c = Number(cartCount24h) || 0;
  const o = Number(sales24h) || 0;

  // ── Scarcity signal (stock → markup, symmetric) ──
  let scarcity;
  if (s === 0)      scarcity = 30;   // out of stock hype pricing
  else if (s <= 5)  scarcity = 20;
  else if (s <= 20) scarcity = 12;
  else if (s <= 50) scarcity = 5;
  else if (s <= 100) scarcity = 0;   // neutral zone
  else if (s <= 200) scarcity = -5;  // high inventory discount
  else               scarcity = -20; // overstock clearance

  // ── Demand signal (24h activity score → markup) ──
  const demandScore = v + c * 3 + o * 8;
  let demand;
  if (demandScore >= 200)      demand = 20;
  else if (demandScore >= 100) demand = 12;
  else if (demandScore >= 50)  demand = 6;
  else                         demand = 0;

  // Clamp to schema bounds
  return Math.max(-20, Math.min(50, scarcity + demand));
}

// ─── Main Cron Function ──────────────────────────────────────────────────────

export async function runDynamicPricingCron() {
  const start = Date.now();
  let processed = 0;
  let updated = 0;
  let skipped = 0;

  logger.info('⚡ Dynamic pricing cron started');

  // Use a cursor to stream products — avoids loading all into RAM
  const cursor = Product.find({ isActive: { $ne: false }, deletedAt: null })
    .select('variants trackingFields dynamicPricingEnabled finalPrice discount')
    .cursor();

  for await (const product of cursor) {
    processed++;

    try {
      const signals = {
        views24h:     product.trackingFields?.views24h     || 0,
        cartCount24h: product.trackingFields?.cartCount24h || 0,
        sales24h:     product.trackingFields?.sales24h     || 0,
      };

      // Build variant-level updates
      const variantUpdates = {};    // { "variants.0.dynamicMarkup": x, "variants.0.finalPrice": y }
      let hasChanges = false;
      let minFinalPrice = Infinity;

      product.variants.forEach((variant, idx) => {
        if (!variant.isActive) return;

        // If dynamic pricing is disabled for this product, force dynamicMarkup to 0
        const nextDynamic = product.dynamicPricingEnabled
          ? computeDynamicMarkup({ stock: variant.stock, ...signals })
          : 0;

        // Run through the engine so the product-level discount is honored.
        const { finalPrice: nextFinal } = calculateFinalPrice({
          product,
          variant: {
            merchantPrice:    variant.merchantPrice,
            nubianMarkup:     variant.nubianMarkup ?? 30,
            dynamicMarkup:    nextDynamic,
            merchantDiscount: variant.merchantDiscount ?? 0,
          },
        });

        // Only record changes (skip if identical — avoids spurious writes)
        if (variant.dynamicMarkup !== nextDynamic) {
          variantUpdates[`variants.${idx}.dynamicMarkup`] = nextDynamic;
          hasChanges = true;
        }
        if (Math.abs((variant.finalPrice || 0) - nextFinal) > 0.01) {
          variantUpdates[`variants.${idx}.finalPrice`] = nextFinal;
          hasChanges = true;
        }

        if (nextFinal > 0 && nextFinal < minFinalPrice) {
          minFinalPrice = nextFinal;
        }
      });

      if (!hasChanges) {
        skipped++;
        continue;
      }

      // Sync root-level finalPrice (lowest active variant)
      const newRootFinal = minFinalPrice === Infinity ? null : minFinalPrice;
      if (Math.abs((product.finalPrice || 0) - (newRootFinal || 0)) > 0.01) {
        variantUpdates.finalPrice = newRootFinal;
      }

      // Single atomic write — no pre-save middleware triggered
      await Product.updateOne(
        { _id: product._id },
        { $set: variantUpdates }
      );

      updated++;
    } catch (err) {
      logger.error('Dynamic pricing cron: error updating product', {
        productId: product._id,
        error: err.message,
      });
    }
  }

  const durationMs = Date.now() - start;
  logger.info('✅ Dynamic pricing cron completed', { processed, updated, skipped, durationMs });

  return { processed, updated, skipped, durationMs };
}
