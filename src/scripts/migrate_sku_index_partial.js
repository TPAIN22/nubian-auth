/**
 * Migration: scope the products SKU uniqueness index to LIVE products.
 *
 * Run with:
 *   node src/scripts/migrate_sku_index_partial.js --dry-run   # inspect, no writes
 *   node src/scripts/migrate_sku_index_partial.js             # apply
 *   node src/scripts/migrate_sku_index_partial.js --rollback  # undo
 *
 * Why:
 *   `variants.sku_1` is `{ unique: true, sparse: true }` over the whole
 *   collection, so a soft-deleted product keeps its SKUs reserved forever.
 *   Deleting a product and re-adding it with the same SKU fails with E11000,
 *   and the product holding the SKU is invisible in the UI (every find is
 *   filtered by `deletedAt: null`), so the error is a dead end.
 *
 *   The replacement, `variants_sku_live_unique`, indexes only live products:
 *     unique: true
 *     partialFilterExpression: { deletedAt: null, 'variants.sku': { $exists: true } }
 *
 *   The `$exists` clause is load-bearing. `sparse` cannot be combined with
 *   `partialFilterExpression`, and without it every live product that has no
 *   variants.sku indexes as null — the second one would collide. (223 of the
 *   241 products in this database are in exactly that state.)
 *
 *   Duplicate SKUs *within a single product* are not caught by either index
 *   (a multikey index de-duplicates keys per document) — `validateVariants` in
 *   products.controller.js is what catches those, before the write. Unchanged.
 *
 * Order of operations:
 *   The new index is built BEFORE the old one is dropped, so there is never a
 *   moment where duplicate live SKUs could slip in unguarded.
 *
 * Safe to run multiple times (idempotent), and reversible via --rollback.
 * Note that rollback can legitimately fail: once live products are allowed to
 * reuse a deleted product's SKU, the old global index no longer builds. The
 * rollback pre-flight says exactly which SKUs are in the way.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { pathToFileURL } from 'url';

dotenv.config();

const argv = process.argv.slice(2);
const hasFlag = (flag) => argv.includes(flag);

const DRY_RUN = hasFlag('--dry-run');
const ROLLBACK = hasFlag('--rollback');

const OLD_INDEX = 'variants.sku_1';
const NEW_INDEX = 'variants_sku_live_unique';

const OLD_SPEC = {
  key: { 'variants.sku': 1 },
  options: { name: OLD_INDEX, unique: true, sparse: true },
};

const NEW_SPEC = {
  key: { 'variants.sku': 1 },
  options: {
    name: NEW_INDEX,
    unique: true,
    partialFilterExpression: { deletedAt: null, 'variants.sku': { $exists: true } },
  },
};

const log = (...args) => console.log(...args);

/**
 * Find SKU values that would violate a unique index over `scope`.
 * Returns [{ sku, docs: [ids] }] — empty when the index can be built.
 */
async function findBlockingDuplicates(col, scope) {
  return col
    .aggregate([
      { $match: scope },
      { $unwind: '$variants' },
      { $match: { 'variants.sku': { $exists: true, $ne: null } } },
      { $group: { _id: '$variants.sku', docs: { $addToSet: '$_id' } } },
      { $match: { $expr: { $gt: [{ $size: '$docs' }, 1] } } },
      { $sort: { _id: 1 } },
      { $limit: 50 },
    ])
    .toArray();
}

async function migrate(col) {
  const indexes = await col.indexes();
  const hasOld = indexes.some((i) => i.name === OLD_INDEX);
  const hasNew = indexes.some((i) => i.name === NEW_INDEX);

  log(`\nCurrent state: ${OLD_INDEX}=${hasOld ? 'present' : 'absent'}, ${NEW_INDEX}=${hasNew ? 'present' : 'absent'}`);

  if (hasNew && !hasOld) {
    log('Already migrated — nothing to do.');
    return;
  }

  // Pre-flight: the new index only covers live products, so only live products
  // can block it. A duplicate between two soft-deleted products is fine now.
  log('\nPre-flight: checking live products for duplicate SKUs...');
  const blocking = await findBlockingDuplicates(col, { deletedAt: null });

  if (blocking.length > 0) {
    log(`\n${blocking.length} SKU(s) are held by more than one LIVE product:`);
    for (const { _id, docs } of blocking) {
      log(`  ${_id}  →  ${docs.map(String).join(', ')}`);
    }
    log('\nThe new unique index cannot be built until these are resolved.');
    log('Fix the duplicates (rename or soft-delete one side), then re-run.');
    throw new Error('Aborted: duplicate SKUs among live products');
  }
  log('  none — clear to build.');

  const liveWithSku = await col.countDocuments({ deletedAt: null, 'variants.sku': { $exists: true } });
  const deletedWithSku = await col.countDocuments({ deletedAt: { $ne: null }, 'variants.sku': { $exists: true } });
  log(`\nProducts that will be indexed : ${liveWithSku} (live, with SKUs)`);
  log(`SKUs this frees up            : held by ${deletedWithSku} soft-deleted product(s)`);

  if (DRY_RUN) {
    log(`\n[DRY RUN] Would create ${NEW_INDEX}: ${JSON.stringify(NEW_SPEC.options)}`);
    log(`[DRY RUN] Would then drop ${OLD_INDEX}`);
    return;
  }

  if (!hasNew) {
    log(`\nCreating ${NEW_INDEX}...`);
    await col.createIndex(NEW_SPEC.key, NEW_SPEC.options);
    log('  created.');
  } else {
    log(`\n${NEW_INDEX} already exists — skipping create.`);
  }

  if (hasOld) {
    // Only ever dropped after the replacement is live, so uniqueness on live
    // products is enforced at every instant.
    log(`Dropping ${OLD_INDEX}...`);
    await col.dropIndex(OLD_INDEX);
    log('  dropped.');
  }
}

async function rollback(col) {
  const indexes = await col.indexes();
  const hasOld = indexes.some((i) => i.name === OLD_INDEX);
  const hasNew = indexes.some((i) => i.name === NEW_INDEX);

  log(`\nCurrent state: ${OLD_INDEX}=${hasOld ? 'present' : 'absent'}, ${NEW_INDEX}=${hasNew ? 'present' : 'absent'}`);

  if (hasOld && !hasNew) {
    log('Already rolled back — nothing to do.');
    return;
  }

  // The old index spans every document, so a duplicate anywhere blocks it —
  // including SKUs the migration deliberately allowed to be reused.
  log('\nPre-flight: checking ALL products (live + soft-deleted) for duplicate SKUs...');
  const blocking = await findBlockingDuplicates(col, {});

  if (blocking.length > 0) {
    log(`\n${blocking.length} SKU(s) appear in more than one product:`);
    for (const { _id, docs } of blocking) {
      log(`  ${_id}  →  ${docs.map(String).join(', ')}`);
    }
    log('\nThese are almost certainly SKUs reused after a product was deleted —');
    log('legal under the partial index, illegal under the global one. Rename or');
    log('hard-delete one side of each pair before rolling back.');
    throw new Error('Aborted: duplicate SKUs across the collection');
  }
  log('  none — clear to rebuild.');

  if (DRY_RUN) {
    log(`\n[DRY RUN] Would create ${OLD_INDEX}: ${JSON.stringify(OLD_SPEC.options)}`);
    log(`[DRY RUN] Would then drop ${NEW_INDEX}`);
    return;
  }

  if (!hasOld) {
    log(`\nRecreating ${OLD_INDEX}...`);
    await col.createIndex(OLD_SPEC.key, OLD_SPEC.options);
    log('  created.');
  }

  if (hasNew) {
    log(`Dropping ${NEW_INDEX}...`);
    await col.dropIndex(NEW_INDEX);
    log('  dropped.');
  }

  log('\nRemember to revert the schema in src/models/product.model.js too,');
  log('or the next server boot will recreate the partial index via autoIndex.');
}

async function run() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  log(`Connected to MongoDB${DRY_RUN ? '  [DRY RUN — no writes]' : ''}`);
  log(`Mode: ${ROLLBACK ? 'ROLLBACK' : 'MIGRATE'}`);

  const col = mongoose.connection.collection('products');

  if (ROLLBACK) await rollback(col);
  else await migrate(col);

  log('\nIndexes on products now:');
  for (const ix of await col.indexes()) {
    if (!String(ix.name).includes('sku')) continue;
    log(`  ${ix.name}: ${JSON.stringify({ key: ix.key, unique: !!ix.unique, sparse: !!ix.sparse, partial: ix.partialFilterExpression })}`);
  }

  await mongoose.disconnect();
  log('\nDone.');
}

// Only run when invoked directly, so the specs can be imported by a test
// without connecting to a database.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  run().catch(async (error) => {
    console.error(`\nMigration failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

export { OLD_SPEC, NEW_SPEC, findBlockingDuplicates };
