import test from 'node:test';
import assert from 'node:assert/strict';

import { pickBestStatus } from '../merchantMembership.service.js';

/* -------------------------------------------------------------------------- */
/* collapsing many stores into one Clerk flag                                 */
/* -------------------------------------------------------------------------- */

test('a single store speaks for itself', () => {
  for (const status of ['approved', 'pending', 'needs_revision', 'rejected', 'suspended']) {
    assert.equal(pickBestStatus([status]), status);
  }
});

test('no stores means no merchant standing at all', () => {
  assert.equal(pickBestStatus([]), null);
  assert.equal(pickBestStatus(undefined), null);
  assert.equal(pickBestStatus(null), null);
});

test('one healthy store is not masked by a suspended one', () => {
  // The case that matters: a member suspended at one store must keep working
  // the store that is still live.
  assert.equal(pickBestStatus(['suspended', 'approved']), 'approved');
  assert.equal(pickBestStatus(['approved', 'suspended']), 'approved');
  assert.equal(pickBestStatus(['rejected', 'suspended', 'approved']), 'approved');
});

test('access-granting statuses outrank access-denying ones', () => {
  assert.equal(pickBestStatus(['rejected', 'pending']), 'pending');
  assert.equal(pickBestStatus(['suspended', 'needs_revision']), 'needs_revision');
  assert.equal(pickBestStatus(['rejected', 'suspended']), 'rejected');
});

test('order of the input never changes the answer', () => {
  const statuses = ['pending', 'suspended', 'approved', 'rejected'];
  const expected = pickBestStatus(statuses);
  assert.equal(expected, 'approved');
  assert.equal(pickBestStatus([...statuses].reverse()), expected);
  assert.equal(pickBestStatus(['suspended', 'rejected', 'pending', 'approved']), expected);
});

test('unknown statuses are ignored rather than winning by accident', () => {
  // Guards against a new Merchant.status enum value silently outranking
  // everything because it is missing from the rank table.
  assert.equal(pickBestStatus(['wat', 'pending']), 'pending');
  assert.equal(pickBestStatus(['wat']), null);
  assert.equal(pickBestStatus([undefined, null, 'approved']), 'approved');
});
