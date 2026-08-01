// Backfill Product.merchant from the legacy Product.merchantId field.
//
// Background: products created before the schema rename store their owner in
// `merchantId`; the current schema (and every query in the app) uses `merchant`.
// A product with a null `merchant` is invisible to getMerchantProducts and, per
// the note in products.controller.js, falls into a "platform" bucket at order
// time — which silently distorts merchant revenue.
//
// This deliberately does NOT blind-copy merchantId into merchant. A legacy id
// can point at a merchant that no longer exists, and copying it would turn a
// visibly-null reference into an invisibly-broken one. Ids are resolved against
// `merchantapplications` first; unresolvable ones need an explicit mapping so
// the attribution decision is made by a human, not inferred by a script.
//
// Report what would happen (default, read-only):
//   node scripts/backfill-product-merchant.js
//
// Apply only the ids that resolve to a real merchant:
//   node scripts/backfill-product-merchant.js --apply
//
// Attribute an unresolvable legacy id to a specific merchant:
//   node scripts/backfill-product-merchant.js --map <legacyId>=<merchantId> --apply
//   (repeatable; --map also accepts <legacyId>=skip to leave those alone)
//
// Include soft-deleted products (default: they are migrated too, so historical
// order attribution stays correct):
//   --live-only   restrict to products with deletedAt: null
import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../src/models/product.model.js';
import Merchant from '../src/models/merchant.model.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const LIVE_ONLY = argv.includes('--live-only');

// --map <legacyId>=<merchantId|skip>, repeatable
const MAPPINGS = new Map();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--map') continue;
  const pair = argv[i + 1];
  if (!pair || !pair.includes('=')) {
    console.error(`--map expects <legacyId>=<merchantId|skip>, got: ${pair}`);
    process.exit(1);
  }
  const [from, to] = pair.split('=');
  MAPPINGS.set(from.trim(), to.trim());
}

const toObjectId = (v) => {
  try {
    return new mongoose.Types.ObjectId(String(v));
  } catch {
    return null;
  }
};

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);

  // Raw collection: the model has a pre-find hook that hides soft-deleted docs,
  // and those need migrating too.
  const products = Product.collection;

  const filter = {
    merchantId: { $exists: true, $ne: null },
    $or: [{ merchant: null }, { merchant: { $exists: false } }],
  };
  if (LIVE_ONLY) filter.deletedAt = null;

  const total = await products.countDocuments(filter);
  if (total === 0) {
    console.log('No products need backfilling.');
    return;
  }

  // Group by legacy id so one lookup covers every product behind it.
  const legacyIds = await products.distinct('merchantId', filter);

  console.log(`${total} product(s) with a legacy merchantId and no merchant.`);
  console.log(`${legacyIds.length} distinct legacy merchant id(s).\n`);

  const existing = await Merchant.collection
    .find({ _id: { $in: legacyIds.map(toObjectId).filter(Boolean) } })
    .project({ storeName: 1 })
    .toArray();
  const byId = new Map(existing.map((m) => [String(m._id), m]));

  const plan = [];

  for (const legacyId of legacyIds) {
    const key = String(legacyId);
    const count = await products.countDocuments({ ...filter, merchantId: legacyId });
    const live = await products.countDocuments({ ...filter, merchantId: legacyId, deletedAt: null });

    const override = MAPPINGS.get(key);
    let target = null;
    let reason = '';

    if (override === 'skip') {
      reason = 'skipped by --map';
    } else if (override) {
      const oid = toObjectId(override);
      const m = oid ? await Merchant.collection.findOne({ _id: oid }, { projection: { storeName: 1 } }) : null;
      if (!m) {
        console.error(`--map target ${override} is not an existing merchant. Aborting.`);
        process.exit(1);
      }
      target = m._id;
      reason = `mapped → ${m.storeName}`;
    } else if (byId.has(key)) {
      target = byId.get(key)._id;
      reason = `resolves → ${byId.get(key).storeName}`;
    } else {
      reason = 'UNRESOLVED — no such merchant; needs --map';
    }

    plan.push({ legacyId, key, count, live, target, reason });
  }

  console.log('legacy merchantId          products (live)  action');
  console.log('─'.repeat(78));
  for (const p of plan) {
    console.log(`${p.key}   ${String(p.count).padStart(5)} (${String(p.live).padStart(4)})  ${p.reason}`);
  }

  const actionable = plan.filter((p) => p.target);
  const blocked = plan.filter((p) => !p.target && !MAPPINGS.has(p.key));
  const willUpdate = actionable.reduce((n, p) => n + p.count, 0);

  console.log('');
  if (blocked.length > 0) {
    const blockedCount = blocked.reduce((n, p) => n + p.count, 0);
    console.log(
      `${blockedCount} product(s) behind ${blocked.length} unresolvable id(s) will NOT be touched.\n` +
      'Decide where each belongs and re-run with, e.g.:\n' +
      blocked.map((p) => `  --map ${p.key}=<merchantId>`).join('\n') +
      '\nor --map <legacyId>=skip to leave them as they are.\n'
    );
  }

  if (willUpdate === 0) {
    console.log('Nothing to apply.');
    return;
  }

  if (!APPLY) {
    console.log(`${willUpdate} product(s) would be updated. Re-run with --apply to write.`);
    return;
  }

  let updated = 0;
  for (const p of actionable) {
    const res = await products.updateMany(
      { ...filter, merchantId: p.legacyId },
      { $set: { merchant: p.target } }
    );
    updated += res.modifiedCount;
    console.log(`Updated ${res.modifiedCount} product(s) for ${p.key}`);
  }

  console.log(`\nDone. ${updated} product(s) now carry a merchant reference.`);

  const remaining = await products.countDocuments({
    $or: [{ merchant: null }, { merchant: { $exists: false } }],
  });
  console.log(`${remaining} product(s) still have no merchant.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
