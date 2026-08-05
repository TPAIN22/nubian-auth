/**
 * Migration: back-fill every existing product with the platform default markup.
 *
 * The target is NUBIAN_MARKUP from .env (see lib/pricing.config.js) — the same
 * knob the running app uses. Changing that env var only affects NEW variants and
 * fallback paths; existing rows keep whatever markup they were stored with.
 * Run this after changing it to bring the catalogue in line.
 *
 * Run with:
 *   node src/scripts/migrate_nubian_markup.js
 *
 * What it does:
 *   1. Finds all products whose variants have a markup != the target (or null)
 *   2. Sets all variant nubianMarkup values to the target
 *   3. Recomputes each variant's finalPrice with the new markup
 *   4. Sets dynamicPricingEnabled: true if not already set
 *   5. Writes changes via bulk updateOne operations (no pre-save triggers)
 *
 * Safe to run multiple times (idempotent).
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Imported after dotenv.config() so pricing.config.js reads a populated .env.
const { default: Product } = await import('../models/product.model.js');
const { DEFAULT_NUBIAN_MARKUP } = await import('../lib/pricing.config.js');

const TARGET_MARKUP = DEFAULT_NUBIAN_MARKUP;

async function run() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('❌  MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('✅  Connected to MongoDB');

  const cursor = Product.find({ deletedAt: null }).cursor();

  let skipped = 0;
  let updated = 0;
  let errors = 0;
  const bulkOps = [];

  console.log(`🔄  Scanning products (target markup: ${TARGET_MARKUP}%)...`);

  for await (const product of cursor) {
    const variantUpdates = {};
    let needsUpdate = false;

    // Add dynamicPricingEnabled if missing
    if (product.dynamicPricingEnabled === undefined || product.dynamicPricingEnabled === null) {
      variantUpdates.dynamicPricingEnabled = true;
      needsUpdate = true;
    }

    product.variants.forEach((variant, idx) => {
      const currentMarkup = variant.nubianMarkup ?? null;
      if (currentMarkup !== TARGET_MARKUP) {
        variantUpdates[`variants.${idx}.nubianMarkup`] = TARGET_MARKUP;
        needsUpdate = true;
      }

      // Always recompute finalPrice with new markup
      const base = variant.merchantPrice || 0;
      if (base > 0) {
        const dm = variant.dynamicMarkup ?? 0;
        const disc = variant.merchantDiscount ?? 0;
        const newFinal = Math.max(1, Math.round((base + base * TARGET_MARKUP / 100 + base * dm / 100 - disc) * 100) / 100);

        if (Math.abs((variant.finalPrice || 0) - newFinal) > 0.01) {
          variantUpdates[`variants.${idx}.finalPrice`] = newFinal;
          needsUpdate = true;
        }
      }
    });

    if (!needsUpdate) {
      skipped++;
      continue;
    }

    // Recompute root finalPrice (minimum of active variant finalPrices)
    const activeFinals = product.variants
      .filter(v => v.isActive !== false)
      .map((v, idx) => variantUpdates[`variants.${idx}.finalPrice`] || v.finalPrice || 0)
      .filter(n => n > 0);

    if (activeFinals.length) {
      variantUpdates.finalPrice = Math.min(...activeFinals);
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: variantUpdates },
      },
    });
    updated++;

    // Flush in batches of 500
    if (bulkOps.length >= 500) {
      try {
        await Product.bulkWrite(bulkOps.splice(0, 500), { ordered: false });
        process.stdout.write('.');
      } catch (e) {
        console.error('\n❌  Bulk write error:', e.message);
        errors++;
      }
    }
  }

  // Flush remaining
  if (bulkOps.length > 0) {
    try {
      await Product.bulkWrite(bulkOps, { ordered: false });
    } catch (e) {
      console.error('\n❌  Final bulk write error:', e.message);
      errors++;
    }
  }

  console.log('\n\n✅  Migration complete!');
  console.log(`   Updated : ${updated} products`);
  console.log(`   Skipped : ${skipped} products (already at ${TARGET_MARKUP}%)`);
  console.log(`   Errors  : ${errors}`);

  await mongoose.disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
