import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

/**
 * Authoritative recalculation of finalPrice based on our Smart Pricing logic.
 * finalPrice = merchantPrice + (merchantPrice * markup%) + (merchantPrice * dynamic%)
 */
const calculateFinal = (obj) => {
  // Manual discountPrice override takes absolute priority
  if (obj.discountPrice && obj.discountPrice > 0) {
    return obj.discountPrice;
  }

  const merchant = obj.merchantPrice || obj.price || 0;
  const markup = obj.nubianMarkup ?? 10;
  const dynamic = obj.dynamicMarkup ?? 0;

  if (merchant <= 0) return 0;

  const markupAmount = (merchant * markup) / 100;
  const dynamicAmount = (merchant * dynamic) / 100;

  return Math.max(0, merchant + markupAmount + dynamicAmount);
};

async function normalizePricesRaw() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected.');

    const db = mongoose.connection.db;
    const collection = db.collection('products');

    // Find products with inflated finalPrice (heuristic: > 1000 USD)
    const filter = {
      $or: [
        { finalPrice: { $gt: 1000 } },
        { 'variants.finalPrice': { $gt: 1000 } }
      ]
    };

    const products = await collection.find(filter).toArray();
    console.log(`Found ${products.length} products potentially requiring normalization.`);

    let updatedCount = 0;

    for (const p of products) {
      console.log(`\nProcessing: [${p._id}] ${p.name}`);
      let modified = false;

      // Normalize Root Prices
      if (p.finalPrice > 1000) {
        console.log(`  Root inflated: F=${p.finalPrice}`);
        p.merchantPrice = (p.merchantPrice || 0) / 100;
        if (p.price) p.price = p.price / 100;
        if (p.discountPrice && p.discountPrice > 0) p.discountPrice = p.discountPrice / 100;
        
        // Recalculate finalPrice
        p.finalPrice = calculateFinal(p);
        modified = true;
      }

      // Normalize Variant Prices
      if (p.variants && Array.isArray(p.variants)) {
        let minFinal = Infinity;
        p.variants.forEach(v => {
          if (v.finalPrice > 1000) {
            console.log(`  Variant [${v.sku}] inflated: F=${v.finalPrice}`);
            v.merchantPrice = (v.merchantPrice || 0) / 100;
            if (v.price) v.price = v.price / 100;
            if (v.discountPrice && v.discountPrice > 0) v.discountPrice = v.discountPrice / 100;
            
            v.finalPrice = calculateFinal(v);
            modified = true;
          }
          
          if (v.isActive && v.finalPrice > 0 && v.finalPrice < minFinal) {
            minFinal = v.finalPrice;
          }
        });

        // Sync root finalPrice to lowest variant if applicable
        if (p.variants.length > 0 && minFinal !== Infinity) {
          p.finalPrice = minFinal;
        }
      }

      if (modified) {
        await collection.updateOne({ _id: p._id }, { $set: p });
        console.log(`  Updated: M=${p.merchantPrice}, F=${p.finalPrice}`);
        updatedCount++;
      } else {
          console.log(`  Skipped (already normalized or false positive)`);
      }
    }

    console.log(`\nNormalization complete. Total updated: ${updatedCount}`);
    await mongoose.connection.close();
  } catch (error) {
    console.error('CRITICAL ERROR:', error);
    process.exit(1);
  }
}

normalizePricesRaw();
