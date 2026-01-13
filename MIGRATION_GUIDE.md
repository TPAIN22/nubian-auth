# Migration Guide: Smart Pricing System

## Overview
This guide helps you migrate existing products to the new Smart Pricing System.

## What Changed

### New Fields Added
- `merchantPrice`: Base price set by merchant (replaces/syncs with `price`)
- `nubianMarkup`: Base markup percentage (default: 10%)
- `dynamicMarkup`: Dynamic markup calculated by system (0-50%)
- `finalPrice`: Calculated final price
- `trackingFields`: 24-hour metrics object
- `rankingFields`: Visibility and ranking metrics object

### Backward Compatibility
- Existing `price` field is automatically synced with `merchantPrice`
- Existing `discountPrice` is still supported
- All existing products will continue to work

## Migration Steps

### Option 1: Automatic Migration (Recommended)
The pre-save middleware automatically handles migration when products are saved:

1. When a product is updated, the middleware will:
   - Sync `merchantPrice` with `price` if `merchantPrice` is missing
   - Calculate `finalPrice` automatically
   - Set default `nubianMarkup` to 10% if missing
   - Initialize `dynamicMarkup` to 0 (will be calculated by cron)

2. **No action required** - products will migrate automatically when updated.

### Option 2: Bulk Migration Script
If you want to migrate all products at once, run this script:

```javascript
// scripts/migrate-pricing.js
import mongoose from 'mongoose';
import Product from '../src/models/product.model.js';
import { connect } from '../src/lib/db.js';

async function migrateProducts() {
  try {
    await connect();
    console.log('Connected to database');
    
    // Get all products
    const products = await Product.find({ deletedAt: null });
    console.log(`Found ${products.length} products to migrate`);
    
    let migrated = 0;
    let errors = 0;
    
    for (const product of products) {
      try {
        // Sync merchantPrice with price
        if (!product.merchantPrice && product.price) {
          product.merchantPrice = product.price;
        }
        
        // Set default nubianMarkup
        if (!product.nubianMarkup && product.nubianMarkup !== 0) {
          product.nubianMarkup = 10;
        }
        
        // Initialize dynamicMarkup
        if (!product.dynamicMarkup && product.dynamicMarkup !== 0) {
          product.dynamicMarkup = 0;
        }
        
        // Initialize trackingFields
        if (!product.trackingFields) {
          product.trackingFields = {
            views24h: 0,
            cartCount24h: 0,
            sales24h: 0,
            favoritesCount: 0,
          };
        }
        
        // Initialize rankingFields
        if (!product.rankingFields) {
          product.rankingFields = {
            visibilityScore: product.visibilityScore || 0,
            priorityScore: product.priorityScore || 0,
            featured: product.featured || false,
            conversionRate: product.conversionRate || 0,
            storeRating: product.storeRating || 0,
          };
        }
        
        // Handle variants
        if (product.variants && product.variants.length > 0) {
          product.variants.forEach(variant => {
            if (!variant.merchantPrice && variant.price) {
              variant.merchantPrice = variant.price;
            }
            if (!variant.nubianMarkup && variant.nubianMarkup !== 0) {
              variant.nubianMarkup = product.nubianMarkup || 10;
            }
            if (!variant.dynamicMarkup && variant.dynamicMarkup !== 0) {
              variant.dynamicMarkup = 0;
            }
          });
        }
        
        // Save product (pre-save middleware will calculate finalPrice)
        await product.save();
        migrated++;
        
        if (migrated % 100 === 0) {
          console.log(`Migrated ${migrated} products...`);
        }
      } catch (error) {
        console.error(`Error migrating product ${product._id}:`, error.message);
        errors++;
      }
    }
    
    console.log(`\nMigration completed!`);
    console.log(`- Migrated: ${migrated}`);
    console.log(`- Errors: ${errors}`);
    console.log(`- Total: ${products.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateProducts();
```

**To run the migration script:**
```bash
node scripts/migrate-pricing.js
```

## Verification

After migration, verify that:

1. All products have `merchantPrice` set:
   ```javascript
   const productsWithoutMerchantPrice = await Product.countDocuments({
     merchantPrice: { $exists: false },
     deletedAt: null
   });
   console.log(`Products without merchantPrice: ${productsWithoutMerchantPrice}`);
   ```

2. All products have `finalPrice` calculated:
   ```javascript
   const productsWithoutFinalPrice = await Product.countDocuments({
     finalPrice: { $exists: false },
     deletedAt: null
   });
   console.log(`Products without finalPrice: ${productsWithoutFinalPrice}`);
   ```

3. Cron job is running:
   - Check logs for "🕐 Hourly cron job started"
   - Verify `dynamicMarkup` is being updated hourly

## Rollback Plan

If you need to rollback:

1. The old `price` field is still present and synced
2. Frontend falls back to `price` if `finalPrice` is missing
3. Simply stop the cron jobs and the system will continue using static pricing

## Testing

1. **Test Product Creation:**
   - Create a new product with `price: 100`
   - Verify `merchantPrice` is set to 100
   - Verify `finalPrice` is calculated (should be ~110 with 10% markup)

2. **Test Product Update:**
   - Update an existing product's price
   - Verify `merchantPrice` and `finalPrice` are updated

3. **Test Cron Job:**
   - Wait for next hour
   - Check logs for pricing recalculation
   - Verify `dynamicMarkup` is updated

4. **Test Frontend:**
   - Verify products display `finalPrice` correctly
   - Check pricing breakdown in admin/merchant dashboards

## Notes

- Migration is **non-destructive** - all existing data is preserved
- Products will continue to work during migration
- Cron jobs will start calculating `dynamicMarkup` after first run
- First pricing calculation happens at the next hour after server start
