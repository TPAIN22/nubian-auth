import test from 'node:test';
import assert from 'node:assert/strict';

import { requireMerchantPermission } from '../merchant.middleware.js';
import { PERMISSIONS } from '../../lib/merchantPermissions.js';

/** Minimal express double: records the status/body a middleware sent. */
const makeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

const makeReq = (over = {}) => ({
  url: '/api/products/123',
  auth: { userId: 'user_test' },
  merchant: { _id: { toString: () => 'store_1' } },
  ...over,
});

/** Runs the gate and reports whether it called next(). */
const run = (permission, req) => {
  const res = makeRes();
  let nexted = false;
  requireMerchantPermission(permission)(req, res, () => {
    nexted = true;
  });
  return { nexted, res };
};

/* -------------------------------------------------------------------------- */
/* the gate                                                                   */
/* -------------------------------------------------------------------------- */

test('a role holding the permission passes through', () => {
  const { nexted, res } = run(
    PERMISSIONS.PRODUCTS_WRITE,
    makeReq({ merchantRole: 'manager' })
  );
  assert.equal(nexted, true);
  assert.equal(res.statusCode, null);
});

test('a role without the permission is refused with the role and requirement', () => {
  const { nexted, res } = run(
    PERMISSIONS.PRODUCTS_WRITE,
    makeReq({ merchantRole: 'staff' })
  );
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'INSUFFICIENT_STORE_PERMISSION');
  assert.equal(res.body.required, PERMISSIONS.PRODUCTS_WRITE);
  assert.equal(res.body.role, 'staff');
});

test('staff can still work orders', () => {
  const { nexted } = run(PERMISSIONS.ORDERS_WRITE, makeReq({ merchantRole: 'staff' }));
  assert.equal(nexted, true);
});

test('only the owner passes the team, payout and profile gates', () => {
  for (const permission of [
    PERMISSIONS.TEAM_WRITE,
    PERMISSIONS.PAYOUTS_WRITE,
    PERMISSIONS.PROFILE_WRITE,
  ]) {
    assert.equal(run(permission, makeReq({ merchantRole: 'owner' })).nexted, true, permission);
    assert.equal(run(permission, makeReq({ merchantRole: 'manager' })).nexted, false, permission);
    assert.equal(run(permission, makeReq({ merchantRole: 'staff' })).nexted, false, permission);
  }
});

/* -------------------------------------------------------------------------- */
/* admins and misuse                                                          */
/* -------------------------------------------------------------------------- */

test('an admin bypasses the gate — they are not a member and carry their own authorization', () => {
  const req = makeReq({ merchantIsAdmin: true, merchant: undefined, merchantRole: undefined });
  const { nexted, res } = run(PERMISSIONS.TEAM_WRITE, req);
  assert.equal(nexted, true);
  assert.equal(res.statusCode, null);
});

test('running without a resolved store fails closed rather than passing through', () => {
  // Guards against the gate being mounted before isApprovedMerchant, which would
  // otherwise silently allow every request.
  const { nexted, res } = run(PERMISSIONS.PRODUCTS_WRITE, makeReq({ merchantRole: undefined }));
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, 'INTERNAL_ERROR');
});

test('the legacy owner fallback keeps full access', () => {
  // resolveMerchantContext synthesizes role 'owner' for stores that predate
  // MerchantMember, so nothing is locked out before the backfill runs.
  for (const permission of Object.values(PERMISSIONS)) {
    assert.equal(run(permission, makeReq({ merchantRole: 'owner' })).nexted, true, permission);
  }
});
