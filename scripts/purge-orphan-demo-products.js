// Soft-delete the seeded demo products that were left pointing at a merchant
// which no longer exists.
//
// Target set: products carrying the legacy `merchantId` field, with no `merchant`
// reference, whose legacy id resolves to no merchant in `merchantapplications`.
// These are unattributable — they cannot be assigned to a store, and while live
// they appear on the storefront credited to nobody, which distorts merchant
// revenue at order time (see the note in products.controller.js:createProduct).
//
// Uses the same soft delete the API uses — `deletedAt` + `isActive: false`, no
// validators — so nothing is destroyed and carts/orders/reviews referencing
// these products keep resolving.
//
// Every applied run writes an undo manifest to scripts/data/ recording exactly
// which documents were touched and what their `isActive` was beforehand. Restore
// reads that back, so it cannot accidentally revive the products that were
// already soft-deleted before this script ran.
//
// Report what would be deleted (default, read-only):
//   node scripts/purge-orphan-demo-products.js
//
// Apply:
//   node scripts/purge-orphan-demo-products.js --apply
//
// Undo a specific run:
//   node scripts/purge-orphan-demo-products.js --restore scripts/data/<manifest>.json
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Product from '../src/models/product.model.js';
import Merchant from '../src/models/merchant.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const RESTORE_AT = argv.indexOf('--restore');
const RESTORE_FILE = RESTORE_AT !== -1 ? argv[RESTORE_AT + 1] : null;

const toObjectId = (v) => {
  try {
    return new mongoose.Types.ObjectId(String(v));
  } catch {
    return null;
  }
};

async function restore(products) {
  if (!RESTORE_FILE || !fs.existsSync(RESTORE_FILE)) {
    console.error(`Manifest not found: ${RESTORE_FILE || '<missing argument>'}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(RESTORE_FILE, 'utf8'));
  const entries = manifest.products || [];
  console.log(`Restoring ${entries.length} product(s) from ${path.basename(RESTORE_FILE)}\n`);

  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to write.');
    return;
  }

  let restored = 0;
  for (const entry of entries) {
    const res = await products.updateOne(
      { _id: toObjectId(entry._id) },
      { $set: { deletedAt: null, isActive: entry.prevIsActive } },
      { runValidators: false }
    );
    restored += res.modifiedCount;
  }

  console.log(`Restored ${restored} product(s).`);
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);

  // Raw collection — the model's pre-find hook hides soft-deleted docs, and the
  // restore path specifically needs to see them.
  const products = Product.collection;

  if (RESTORE_FILE) return restore(products);

  // Which legacy ids are genuinely unresolvable? Anything that DOES resolve
  // belongs to a real store and must be backfilled, not deleted.
  const legacyIds = await products.distinct('merchantId', {
    merchantId: { $exists: true, $ne: null },
    $or: [{ merchant: null }, { merchant: { $exists: false } }],
  });

  const resolvable = await Merchant.collection
    .find({ _id: { $in: legacyIds.map(toObjectId).filter(Boolean) } })
    .project({ _id: 1 })
    .toArray();
  const resolvableSet = new Set(resolvable.map((m) => String(m._id)));

  const unresolvable = legacyIds.filter((id) => !resolvableSet.has(String(id)));

  if (resolvableSet.size > 0) {
    console.log(
      `${resolvableSet.size} legacy id(s) DO resolve to a real merchant and are left alone — ` +
      'run backfill-product-merchant.js for those.\n'
    );
  }

  if (unresolvable.length === 0) {
    console.log('No unattributable products found. Nothing to do.');
    return;
  }

  const filter = {
    merchantId: { $in: unresolvable },
    $or: [{ merchant: null }, { merchant: { $exists: false } }],
    deletedAt: null, // already-deleted ones need no action
  };

  const doomed = await products
    .find(filter)
    .project({ name: 1, isActive: 1, status: 1 })
    .toArray();

  if (doomed.length === 0) {
    console.log('All unattributable products are already soft-deleted. Nothing to do.');
    return;
  }

  console.log(
    `${doomed.length} live product(s) behind ${unresolvable.length} unresolvable ` +
    `merchant id(s) would be soft-deleted:\n`
  );
  for (const p of doomed.slice(0, 15)) {
    console.log(`  ${p._id}  ${p.name}`);
  }
  if (doomed.length > 15) console.log(`  ... and ${doomed.length - 15} more`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to soft-delete these.');
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestPath = path.join(DATA_DIR, `demo-purge-${stamp}.json`);

  // Manifest first: if the update dies halfway, the undo list still covers
  // everything that could possibly have changed.
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        purgedAt: new Date().toISOString(),
        reason: 'Seeded demo products with an unresolvable legacy merchantId',
        legacyMerchantIds: unresolvable.map(String),
        products: doomed.map((p) => ({
          _id: String(p._id),
          name: p.name,
          prevIsActive: p.isActive !== false,
        })),
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`\nUndo manifest written: ${path.relative(process.cwd(), manifestPath)}`);

  const res = await products.updateMany(
    { _id: { $in: doomed.map((p) => p._id) } },
    { $set: { deletedAt: new Date(), isActive: false } },
    { runValidators: false }
  );

  console.log(`Soft-deleted ${res.modifiedCount} product(s).`);
  console.log(
    `\nUndo with:\n  node scripts/purge-orphan-demo-products.js --restore ` +
    `${path.relative(process.cwd(), manifestPath)} --apply`
  );

  const stillLive = await products.countDocuments({
    deletedAt: null,
    $or: [{ merchant: null }, { merchant: { $exists: false } }],
  });
  console.log(`\n${stillLive} live product(s) still have no merchant.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
