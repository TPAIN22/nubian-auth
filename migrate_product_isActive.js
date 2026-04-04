/**
 * Migration: Backfill isActive=true on products that don't have the field set.
 *
 * Background:
 *   The old product schema did not declare `isActive`, so Mongoose strict mode
 *   prevented it from being stored via document.save(). Products created via
 *   the old API therefore have no `isActive` field in MongoDB.
 *
 *   After the schema update (isActive now declared at root level with default: true),
 *   the getProducts filter was updated to use `{ isActive: { $ne: false } }` for
 *   backward compatibility. However, running this migration explicitly sets the
 *   field to `true` on all legacy documents, making queries cleaner going forward.
 *
 * Run once with:
 *   node migrate_product_isActive.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL;

if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI or DATABASE_URL env variable is required');
  process.exit(1);
}

async function migrate() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  const db = mongoose.connection.db;
  const collection = db.collection('products');

  // Count products without isActive field
  const missing = await collection.countDocuments({ isActive: { $exists: false } });
  const falseCount = await collection.countDocuments({ isActive: false });
  const trueCount = await collection.countDocuments({ isActive: true });
  const total = await collection.countDocuments({});

  console.log(`\nProduct isActive field summary:`);
  console.log(`  Total products in DB:       ${total}`);
  console.log(`  isActive = true:            ${trueCount}`);
  console.log(`  isActive = false:           ${falseCount}`);
  console.log(`  isActive field missing:     ${missing}`);
  console.log(`  Will be updated (missing):  ${missing}`);

  if (missing === 0) {
    console.log('\n✅ Nothing to migrate — all products already have isActive set.');
    await mongoose.disconnect();
    return;
  }

  console.log(`\nSetting isActive=true on ${missing} products...`);
  const result = await collection.updateMany(
    { isActive: { $exists: false } },
    { $set: { isActive: true } }
  );

  console.log(`✅ Migration complete: ${result.modifiedCount} products updated.`);

  // Verify
  const afterMissing = await collection.countDocuments({ isActive: { $exists: false } });
  const afterTrue = await collection.countDocuments({ isActive: true });
  console.log(`\nAfter migration:`);
  console.log(`  isActive = true:         ${afterTrue}`);
  console.log(`  isActive field missing:  ${afterMissing}`);

  await mongoose.disconnect();
  console.log('\nDisconnected. Done.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
