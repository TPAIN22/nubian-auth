import test from 'node:test';
import assert from 'node:assert/strict';

import { diffOwnership } from '../merchantMembership.service.js';

/* ============================================================================
   Readiness to remove the legacy owner fallback
   ----------------------------------------------------------------------------
   While merchant.middleware.js falls back to Merchant.findOne({ userId }), a
   store whose owner has no membership row still works. Remove the fallback and
   the same store 403s its own owner. These tests pin what counts as "not ready",
   because getting that wrong is what locks a merchant out of their shop.
   ========================================================================== */

const store = (over = {}) => ({
  _id: 'store1',
  storeName: 'Test Store',
  userId: 'user_owner',
  status: 'approved',
  ...over,
});

const member = (over = {}) => ({
  _id: 'mem1',
  merchant: 'store1',
  userId: 'user_owner',
  email: 'owner@example.com',
  role: 'owner',
  status: 'active',
  ...over,
});

test('a store with a matching owner membership is ready', () => {
  const report = diffOwnership([store()], [member()]);
  assert.equal(report.ready, true);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.mismatched, []);
  assert.deepEqual(report.orphaned, []);
  assert.equal(report.ownedStoreCount, 1);
});

test('nothing at all is ready — there is nobody to lock out', () => {
  const report = diffOwnership([], []);
  assert.equal(report.ready, true);
});

/* -------------------------------------------------------------------------- */
/* the three ways it can be unsafe                                            */
/* -------------------------------------------------------------------------- */

test('an owned store with no owner membership is NOT ready', () => {
  const report = diffOwnership([store()], []);
  assert.equal(report.ready, false);
  assert.equal(report.missing.length, 1);
  assert.equal(report.missing[0].merchantId, 'store1');
  assert.equal(report.missing[0].userId, 'user_owner');
});

test('the two owner records disagreeing is NOT ready', () => {
  // A half-finished ownership transfer: the fallback would serve the old owner
  // and the resolver the new one.
  const report = diffOwnership([store()], [member({ userId: 'user_someone_else' })])
  assert.equal(report.ready, false)
  assert.equal(report.mismatched.length, 1)
  assert.equal(report.mismatched[0].storeOwnerUserId, 'user_owner')
  assert.equal(report.mismatched[0].membershipOwnerUserId, 'user_someone_else')
})

test('a membership pointing at a deleted store is NOT ready', () => {
  const report = diffOwnership([store()], [member(), member({ _id: 'mem2', merchant: 'gone' })]);
  assert.equal(report.ready, false);
  assert.equal(report.orphaned.length, 1);
  assert.equal(report.orphaned[0].merchantId, 'gone');
});

/* -------------------------------------------------------------------------- */
/* what must NOT be flagged                                                   */
/* -------------------------------------------------------------------------- */

test('unclaimed stores are not expected to have an owner membership', () => {
  // Their `unclaimed:<uuid>` userId is a placeholder, not a person — the owner
  // row is written when an admin links a real account. Flagging these would
  // make the check permanently red for a perfectly healthy platform.
  const report = diffOwnership([store({ userId: 'unclaimed:abc-123' })], []);
  assert.equal(report.ready, true);
  assert.equal(report.ownedStoreCount, 0);
  assert.equal(report.storeCount, 1);
});

test('a store with no userId at all is not counted as owned', () => {
  const report = diffOwnership([store({ userId: null })], []);
  assert.equal(report.ready, true);
  assert.equal(report.ownedStoreCount, 0);
});

test('staff memberships neither satisfy nor break the owner check', () => {
  const report = diffOwnership(
    [store()],
    [member(), member({ _id: 'mem2', role: 'staff', userId: 'user_staff' })],
  );
  assert.equal(report.ready, true);
  assert.equal(report.membershipCount, 2);
});

test('a revoked owner row does not count as having an owner', () => {
  // Revoked rows are kept for audit. Treating one as live would report a store
  // as safe when its owner can no longer resolve.
  const report = diffOwnership([store()], [member({ status: 'revoked' })]);
  assert.equal(report.ready, false);
  assert.equal(report.missing.length, 1);
});

test('an invited-but-unaccepted owner row does not count either', () => {
  const report = diffOwnership([store()], [member({ status: 'invited', userId: null })]);
  assert.equal(report.ready, false);
  assert.equal(report.missing.length, 1);
});

/* -------------------------------------------------------------------------- */
/* mixed reality                                                              */
/* -------------------------------------------------------------------------- */

test('reports every problem at once rather than stopping at the first', () => {
  const report = diffOwnership(
    [
      store({ _id: 'ok', userId: 'u_ok' }),
      store({ _id: 'nomember', userId: 'u_missing' }),
      store({ _id: 'drift', userId: 'u_old' }),
      store({ _id: 'placeholder', userId: 'unclaimed:zzz' }),
    ],
    [
      member({ _id: 'm_ok', merchant: 'ok', userId: 'u_ok' }),
      member({ _id: 'm_drift', merchant: 'drift', userId: 'u_new' }),
      member({ _id: 'm_orphan', merchant: 'deleted-store' }),
    ],
  );

  assert.equal(report.ready, false);
  assert.equal(report.ownedStoreCount, 3);
  assert.deepEqual(
    report.missing.map((m) => m.merchantId),
    ['nomember'],
  );
  assert.deepEqual(
    report.mismatched.map((m) => m.merchantId),
    ['drift'],
  );
  assert.deepEqual(
    report.orphaned.map((m) => m.merchantId),
    ['deleted-store'],
  );
});

test('ObjectId-like values compare by string, not by identity', () => {
  // Mongo hands back ObjectId instances; two for the same id are not ===.
  const oid = (v) => ({ toString: () => v });
  const report = diffOwnership(
    [store({ _id: oid('store1') })],
    [member({ merchant: oid('store1') })],
  );
  assert.equal(report.ready, true);
});
