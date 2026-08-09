// Backfill MerchantMember owner rows from the legacy Merchant.userId field.
//
// Background: before MerchantMember existed, a store's operator *was* the store
// row — Merchant.userId, unique-indexed, resolved on every merchant request.
// The membership table replaces that lookup, so every existing store needs the
// owner row it would have had if it had been created after the change.
//
// Until this has run, merchant.middleware.js falls back to
// Merchant.findOne({ userId }) and logs `legacyOwnerFallback`. Nothing breaks
// before it runs; the fallback just stays warm.
//
// Unclaimed stores (userId `unclaimed:<uuid>`) are deliberately skipped. Those
// placeholders are not people — the owner membership is created when an admin
// links a real user via linkStoreToUser.
//
// Report what would happen (default, read-only):
//   node scripts/backfill-merchant-members.js
//
// Write the owner rows:
//   node scripts/backfill-merchant-members.js --apply
//
// Idempotent: re-running only fills gaps. Existing owner rows are never
// modified, so a hand-corrected role or email survives a re-run.
import 'dotenv/config';
import mongoose from 'mongoose';
import Merchant, { isUnclaimedUserId } from '../src/models/merchant.model.js';
import MerchantMember from '../src/models/merchantMember.model.js';

const APPLY = process.argv.slice(2).includes('--apply');

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }

  // A dry run must not write, and mongoose's autoIndex would otherwise create
  // the collection and its indexes the moment the model is first queried.
  await mongoose.connect(uri, { autoIndex: APPLY });

  const merchants = await Merchant.find({})
    .select('userId storeName email status claimStatus createdAt')
    .lean();

  console.log(`${merchants.length} store(s) in merchantapplications.\n`);

  const existing = await MerchantMember.find({ role: 'owner' })
    .select('merchant')
    .lean();
  const alreadyHasOwner = new Set(existing.map((m) => m.merchant.toString()));

  const toCreate = [];
  const skippedUnclaimed = [];
  const skippedExisting = [];
  const blocked = [];

  for (const m of merchants) {
    const id = m._id.toString();

    if (alreadyHasOwner.has(id)) {
      skippedExisting.push(m);
      continue;
    }
    if (!m.userId || isUnclaimedUserId(m.userId)) {
      skippedUnclaimed.push(m);
      continue;
    }
    // email is schema-required, but legacy rows predate that. A membership with
    // no email can never be matched by an invite accept, so surface it rather
    // than writing a row that silently cannot be re-invited against.
    if (!m.email) {
      blocked.push({ merchant: m, reason: 'no email on the store row' });
      continue;
    }

    toCreate.push(m);
  }

  console.log(`  ${skippedExisting.length} already have an owner membership`);
  console.log(`  ${skippedUnclaimed.length} unclaimed (owner row created at link time)`);
  console.log(`  ${blocked.length} blocked`);
  console.log(`  ${toCreate.length} need an owner membership\n`);

  if (blocked.length > 0) {
    console.log('Blocked:');
    for (const b of blocked) {
      console.log(`  ${b.merchant._id}  ${b.merchant.storeName} — ${b.reason}`);
    }
    console.log('');
  }

  if (toCreate.length === 0) {
    console.log('Nothing to create.');
    return;
  }

  if (!APPLY) {
    console.log('Would create owner memberships for:');
    for (const m of toCreate.slice(0, 25)) {
      console.log(`  ${m._id}  ${m.storeName}  <${m.email}>  [${m.status}]`);
    }
    if (toCreate.length > 25) {
      console.log(`  … and ${toCreate.length - 25} more`);
    }
    console.log(`\n${toCreate.length} row(s) would be written. Re-run with --apply.`);
    return;
  }

  // Build the unique indexes first — without them a concurrent double-run could
  // write two owner rows for one store, which is exactly what they prevent.
  await MerchantMember.createIndexes();

  const now = new Date();
  const ops = toCreate.map((m) => ({
    updateOne: {
      filter: { merchant: m._id, role: 'owner' },
      update: {
        $setOnInsert: {
          merchant: m._id,
          userId: m.userId,
          email: m.email.toLowerCase().trim(),
          role: 'owner',
          status: 'active',
          // The owner did not accept an invite; the store's creation *is* the
          // acceptance. Dating it from the store keeps the audit trail honest.
          acceptedAt: m.createdAt || now,
        },
      },
      upsert: true,
    },
  }));

  const result = await MerchantMember.bulkWrite(ops, { ordered: false });
  console.log(`Created ${result.upsertedCount} owner membership(s).`);

  const total = await MerchantMember.countDocuments({ role: 'owner' });
  const claimed = await Merchant.countDocuments({ claimStatus: 'claimed' });
  console.log(`\n${total} owner membership(s) now exist across ${claimed} claimed store(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
