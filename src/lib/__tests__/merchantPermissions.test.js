import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  permissionsForRole,
} from '../merchantPermissions.js';
import { MERCHANT_ROLES } from '../../models/merchantMember.model.js';

/* -------------------------------------------------------------------------- */
/* the matrix                                                                 */
/* -------------------------------------------------------------------------- */

test('every role in the model has a permission set', () => {
  for (const role of MERCHANT_ROLES) {
    assert.ok(
      Array.isArray(ROLE_PERMISSIONS[role]),
      `role "${role}" has no entry in ROLE_PERMISSIONS`
    );
  }
});

test('owner holds every permission', () => {
  for (const permission of Object.values(PERMISSIONS)) {
    assert.equal(hasPermission('owner', permission), true, permission);
  }
});

test('only the owner can manage the team, payouts, or the storefront identity', () => {
  for (const permission of [
    PERMISSIONS.TEAM_WRITE,
    PERMISSIONS.PAYOUTS_WRITE,
    PERMISSIONS.PROFILE_WRITE,
  ]) {
    assert.equal(hasPermission('manager', permission), false, permission);
    assert.equal(hasPermission('staff', permission), false, permission);
  }
});

test('managers own the catalogue and its commercial levers', () => {
  for (const permission of [
    PERMISSIONS.PRODUCTS_WRITE,
    PERMISSIONS.COUPONS_WRITE,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.MARKETING_SEND,
  ]) {
    assert.equal(hasPermission('manager', permission), true, permission);
    assert.equal(hasPermission('staff', permission), false, permission);
  }
});

test('staff can work orders but not rewrite the catalogue', () => {
  assert.equal(hasPermission('staff', PERMISSIONS.ORDERS_READ), true);
  assert.equal(hasPermission('staff', PERMISSIONS.ORDERS_WRITE), true);
  assert.equal(hasPermission('staff', PERMISSIONS.PRODUCTS_READ), true);
  assert.equal(hasPermission('staff', PERMISSIONS.PRODUCTS_WRITE), false);
});

test('permissions are cumulative up the roles', () => {
  const staff = new Set(permissionsForRole('staff'));
  const manager = new Set(permissionsForRole('manager'));
  const owner = new Set(permissionsForRole('owner'));

  for (const p of staff) assert.ok(manager.has(p), `manager is missing ${p}`);
  for (const p of manager) assert.ok(owner.has(p), `owner is missing ${p}`);
});

/* -------------------------------------------------------------------------- */
/* unknown input                                                              */
/* -------------------------------------------------------------------------- */

test('an unknown or absent role grants nothing', () => {
  for (const role of ['admin', 'user', '', null, undefined]) {
    assert.equal(hasPermission(role, PERMISSIONS.ORDERS_READ), false, String(role));
    assert.deepEqual(permissionsForRole(role), []);
  }
});

test('an unknown permission is never granted, not even to the owner', () => {
  assert.equal(hasPermission('owner', 'store:delete'), false);
});

test('the permission sets cannot be mutated by a caller', () => {
  assert.throws(() => permissionsForRole('staff').push(PERMISSIONS.TEAM_WRITE));
  assert.equal(hasPermission('staff', PERMISSIONS.TEAM_WRITE), false);
});
