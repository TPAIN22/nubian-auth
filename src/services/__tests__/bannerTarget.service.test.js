import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import Merchant from '../../models/merchant.model.js';
import Product from '../../models/product.model.js';
import Category from '../../models/categories.model.js';
import Collection from '../../models/collection.model.js';
import { resolveBannerTarget } from '../bannerTarget.service.js';

/**
 * Banner target resolution against the database.
 *
 * The models are Mongoose singletons and the service looks `exists` up on them
 * at call time, so replacing that one method is enough to drive the whole
 * resolver without a connection — and it lets each test assert the exact filter
 * the service sends, which is where the `collection` rule actually lives (it is
 * the only type that also requires `isActive: true`).
 */

const OID = '507f1f77bcf86cd799439011';

const MODELS = { Merchant, Product, Category, Collection };
const ORIGINAL = new Map(Object.entries(MODELS).map(([k, m]) => [k, m.exists]));

/** Make every model's `exists` return `found`, recording the filters it saw. */
const stubExists = (found) => {
  const calls = [];
  for (const model of Object.values(MODELS)) {
    model.exists = (filter) => {
      calls.push(filter);
      return Promise.resolve(found ? { _id: filter._id } : null);
    };
  }
  return calls;
};

beforeEach(() => {
  for (const [name, original] of ORIGINAL) MODELS[name].exists = original;
});

/* -------------------------------------------------------------------------- */
/* Targets that need no database                                              */
/* -------------------------------------------------------------------------- */

test('resolves none and url without touching the database', async () => {
  stubExists(false); // would reject everything if it were consulted
  assert.deepEqual(await resolveBannerTarget(undefined), { type: 'none' });
  assert.deepEqual(await resolveBannerTarget({ type: 'none' }), { type: 'none' });
  assert.deepEqual(await resolveBannerTarget({ type: 'url', url: 'https://nubian-sd.com' }), {
    type: 'url',
    url: 'https://nubian-sd.com',
  });
});

/* -------------------------------------------------------------------------- */
/* Existing types keep working                                                */
/* -------------------------------------------------------------------------- */

test('still resolves store, product and category targets', async () => {
  for (const type of ['store', 'product', 'category']) {
    stubExists(true);
    assert.deepEqual(await resolveBannerTarget({ type, id: OID }), { type, id: OID });
  }
});

test('still rejects a store, product or category that does not exist', async () => {
  for (const type of ['store', 'product', 'category']) {
    stubExists(false);
    await assert.rejects(resolveBannerTarget({ type, id: OID }), (err) => {
      assert.equal(err.code, 'BANNER_TARGET_NOT_FOUND');
      assert.equal(err.statusCode, 404);
      return true;
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Collection                                                                 */
/* -------------------------------------------------------------------------- */

test('resolves a collection target now that Collections exist', async () => {
  stubExists(true);
  assert.deepEqual(await resolveBannerTarget({ type: 'collection', id: OID }), {
    type: 'collection',
    id: OID,
  });
});

test('a collection target is checked for isActive, not just existence', async () => {
  const calls = stubExists(true);
  await resolveBannerTarget({ type: 'collection', id: OID });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].isActive, true);
  assert.equal(String(calls[0]._id), OID);
});

test('rejects a nonexistent or inactive collection', async () => {
  stubExists(false);
  await assert.rejects(resolveBannerTarget({ type: 'collection', id: OID }), (err) => {
    assert.equal(err.code, 'BANNER_TARGET_NOT_FOUND');
    assert.equal(err.statusCode, 404);
    assert.match(err.details[0].message, /does not exist or is not active/);
    return true;
  });
});

test('no longer rejects collection targets as unsupported', async () => {
  stubExists(true);
  // The old behaviour was a 400 BANNER_TARGET_TYPE_UNSUPPORTED before any
  // database lookup happened at all.
  await assert.doesNotReject(resolveBannerTarget({ type: 'collection', id: OID }));
});

/* -------------------------------------------------------------------------- */
/* Shape errors still surface before the database                             */
/* -------------------------------------------------------------------------- */

test('a malformed target degrades to none rather than hitting the database', async () => {
  const calls = stubExists(true);
  assert.deepEqual(await resolveBannerTarget({ type: 'collection' }), { type: 'none' });
  assert.equal(calls.length, 0);
});
