// Audit (and optionally drop) indexes on `products` that no longer exist in the
// Mongoose schema.
//
// Why this is needed: Mongoose creates the indexes a schema declares, but it
// never drops ones it doesn't recognise. `product.model.js` has no `slug` field,
// yet the collection still carries a unique `slug_1` index from an older schema.
// Every product now saves with no slug key, which a non-sparse unique index
// treats as null — so the first such product inserts fine and the second fails
// with:
//
//   E11000 duplicate key error collection: nubian.products
//   index: slug_1 dup key: { slug: null }
//
// Dry run (default) — lists indexes and flags the stale ones:
//   node scripts/fix-stale-product-indexes.js
//
// Drop them:
//   node scripts/fix-stale-product-indexes.js --drop
import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../src/models/product.model.js';

const SHOULD_DROP = process.argv.includes('--drop');

// Indexes known to be obsolete. Deliberately an explicit allowlist rather than
// "anything not in the schema" — a blind diff would happily drop indexes added
// on purpose outside Mongoose (TTL, partial, text), and "not in the schema" does
// NOT imply "not in the data": most of this collection predates the current
// schema and still carries legacy fields that live queries read.
//
// Verified against the collection before being listed here (counts at the time
// of writing, 236 products total):
//   slug_1                          0 docs have `slug`   — dropped, was breaking inserts
//   displayFinalPrice_1_createdAt_-1  0 docs             — never persisted, output-only field
//   variants.discountPrice_-1         0 docs             — dead
//
// Deliberately NOT listed, despite being absent from the schema:
//   discountPrice_-1_createdAt_-1   162 docs have the field, and the price-range
//                                   filter in products.controller.js queries it
//                                   for every product lacking `finalPrice` (223).
//   merchantId_1                    223 docs still link their merchant through
//                                   the legacy `merchantId` field. Drop only
//                                   after those are migrated to `merchant`.
const STALE_INDEXES = [
  'slug_1',
  'displayFinalPrice_1_createdAt_-1',
  'variants.discountPrice_-1',
];

// Never dropped, whatever else happens.
const PROTECTED = new Set(['_id_']);

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const collection = Product.collection;

  const indexes = await collection.indexes();

  console.log(`Indexes on "${collection.collectionName}":\n`);
  for (const idx of indexes) {
    const flags = [
      idx.unique ? 'unique' : null,
      idx.sparse ? 'sparse' : null,
      idx.partialFilterExpression ? 'partial' : null,
    ].filter(Boolean).join(',');

    const stale = STALE_INDEXES.includes(idx.name) && !PROTECTED.has(idx.name);
    console.log(
      `  ${stale ? 'STALE →' : '       '} ${idx.name}` +
      `\t${JSON.stringify(idx.key)}${flags ? `\t[${flags}]` : ''}`,
    );
  }

  const present = indexes
    .map((i) => i.name)
    .filter((n) => STALE_INDEXES.includes(n) && !PROTECTED.has(n));

  if (present.length === 0) {
    console.log('\nNo stale indexes present. Nothing to do.');
    return;
  }

  if (!SHOULD_DROP) {
    console.log(
      `\n${present.length} stale index(es) found: ${present.join(', ')}` +
      '\nRe-run with --drop to remove them.',
    );
    return;
  }

  for (const name of present) {
    await collection.dropIndex(name);
    console.log(`\nDropped index: ${name}`);
  }

  console.log('\nRemaining indexes:');
  for (const idx of await collection.indexes()) {
    console.log(`  ${idx.name}\t${JSON.stringify(idx.key)}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
