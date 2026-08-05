/**
 * Migration: Set nubianMarkup to 30% on all existing products
 *
 * Run with:
 *   node src/scripts/migrate_nubianMarkup_30.js
 *
 * What it does:
 *   1. Finds all products whose variants have nubianMarkup != 30 (or null/undefined)
 *   2. Sets all variant nubianMarkup values to 30
 *   3. Recomputes each variant's finalPrice with the new markup
 *   4. Sets dynamicPricingEnabled: true if not already set
 *   5. Writes changes via bulk updateOne operations (no pre-save triggers)
 *
 * Safe to run multiple times (idempotent).
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/product.model.js';

dotenv.config();

const TARGET_MARKUP = 30;

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

  console.log('🔄  Scanning products...');

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
  console.log(`   Skipped : ${skipped} products (already at 30%)`);
  console.log(`   Errors  : ${errors}`);

  await mongoose.disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
