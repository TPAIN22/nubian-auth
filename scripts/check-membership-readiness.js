// Is it safe to remove the legacy owner fallback yet?
//
// While merchant.middleware.js still falls back to Merchant.findOne({ userId }),
// a store whose owner has no membership row keeps working — the resolver quietly
// drops back to the owner pointer. Remove the fallback and that same store
// becomes a 403 for the person who owns it.
//
// This reports every disagreement between the two sources of truth. The
// fallback may be deleted only when it reports READY.
//
//   node scripts/check-membership-readiness.js
//
// Read-only. Exits 1 when not ready, so it can gate a deploy step.
import 'dotenv/config';
import mongoose from 'mongoose';
import { checkMembershipReadiness } from '../src/services/merchantMembership.service.js';

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }

  // Read-only: never let a check create the collection or its indexes.
  await mongoose.connect(uri, { autoIndex: false });

  const report = await checkMembershipReadiness();

  console.log(`${report.storeCount} store(s), ${report.ownedStoreCount} with a real owner`);
  console.log(`${report.membershipCount} membership row(s)\n`);

  if (report.missing.length > 0) {
    console.log(`${report.missing.length} owned store(s) with NO owner membership:`);
    console.log('  (these owners would lose access if the fallback were removed)');
    for (const s of report.missing) {
      console.log(`  ${s.merchantId}  ${s.storeName}  [${s.status}]  owner=${s.userId}`);
    }
    console.log('  → re-run: npm run backfill:merchant-members -- --apply\n');
  }

  if (report.mismatched.length > 0) {
    console.log(`${report.mismatched.length} store(s) where the two owners DISAGREE:`);
    console.log('  (the fallback and the resolver would serve different people)');
    for (const s of report.mismatched) {
      console.log(`  ${s.merchantId}  ${s.storeName}`);
      console.log(`      store.userId      = ${s.storeOwnerUserId}`);
      console.log(`      membership.userId = ${s.membershipOwnerUserId}`);
    }
    console.log('  → likely a half-finished ownership transfer; reconcile by hand\n');
  }

  if (report.orphaned.length > 0) {
    console.log(`${report.orphaned.length} membership(s) pointing at a store that no longer exists:`);
    for (const m of report.orphaned) {
      console.log(`  ${m.membershipId}  merchant=${m.merchantId}  ${m.email}  ${m.role}/${m.status}`);
    }
    console.log('  → these resolve to a 403 for whoever holds them\n');
  }

  if (report.ready) {
    console.log('READY — every owned store has a matching owner membership.');
    console.log('The legacy fallback in merchant.middleware.js can be removed once');
    console.log('`legacyOwnerFallback` has also been absent from the logs for a release.');
    return;
  }

  console.log('NOT READY — resolve the above before removing the fallback.');
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
