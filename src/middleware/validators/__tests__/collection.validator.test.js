import test from 'node:test';
import assert from 'node:assert/strict';
import { validationResult } from 'express-validator';

import {
  validateCollectionCreate,
  validateCollectionUpdate,
} from '../collection.validator.js';
import { COLLECTION_NAME_MAX, COLLECTION_PRODUCTS_MAX } from '../../../lib/collection.js';

const A = '507f1f77bcf86cd799439011';
const B = '507f191e810c19729de860ea';
const IMAGE = 'https://ik.imagekit.io/nubian/ramadan.png';

/**
 * Run a validator chain the way the router would, returning both the errors and
 * the sanitised body — the sanitiser is part of the contract, because it is
 * what unwraps `{ _id }` picker options before the controller persists them.
 */
const run = async (chains, body) => {
  const req = { body, params: {}, query: {} };
  for (const chain of chains) await chain.run(req);
  return { errors: validationResult(req).array(), body: req.body };
};

const errorsFor = (errors, field) => errors.filter((e) => e.path === field);

/* -------------------------------------------------------------------------- */
/* Accepted payloads                                                          */
/* -------------------------------------------------------------------------- */

test('accepts a minimal collection — name only', async () => {
  const { errors } = await run(validateCollectionCreate, { name: 'Ramadan Favorites' });
  assert.deepEqual(errors, []);
});

test('accepts a full collection', async () => {
  const { errors, body } = await run(validateCollectionCreate, {
    name: 'Ramadan Favorites',
    description: 'Hand-picked for the season',
    image: IMAGE,
    slug: 'ramadan-favorites',
    products: [A, B],
    isActive: true,
    sortOrder: 3,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(body.products, [A, B]);
  assert.equal(body.sortOrder, 3);
  assert.equal(body.isActive, true);
});

test('sanitises picker option objects down to bare ids, order preserved', async () => {
  const { errors, body } = await run(validateCollectionCreate, {
    name: 'Picks',
    products: [{ _id: B, label: 'Jalabiya' }, { id: A }],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(body.products, [B, A]);
});

test('accepts an empty image string — that is how the picture is cleared', async () => {
  const { errors } = await run(validateCollectionUpdate, { image: '' });
  assert.deepEqual(errors, []);
});

test('update is a partial — isActive alone is valid', async () => {
  const { errors, body } = await run(validateCollectionUpdate, { isActive: false });
  assert.deepEqual(errors, []);
  assert.equal(body.isActive, false);
  assert.equal(body.name, undefined);
});

/* -------------------------------------------------------------------------- */
/* Rejected payloads                                                          */
/* -------------------------------------------------------------------------- */

test('rejects a create with no name', async () => {
  const { errors } = await run(validateCollectionCreate, {});
  assert.ok(errorsFor(errors, 'name').length > 0);
});

test('rejects an empty or whitespace-only name', async () => {
  for (const name of ['', '   ']) {
    const { errors } = await run(validateCollectionCreate, { name });
    assert.ok(errorsFor(errors, 'name').length > 0, `"${name}" should be rejected`);
  }
});

test('rejects a name past the length cap', async () => {
  const { errors } = await run(validateCollectionCreate, { name: 'x'.repeat(COLLECTION_NAME_MAX + 1) });
  assert.match(errorsFor(errors, 'name')[0].msg, /between/);
});

test('rejects an invalid product id', async () => {
  const { errors } = await run(validateCollectionCreate, {
    name: 'Picks',
    products: [A, 'product_1'],
  });
  assert.match(errorsFor(errors, 'products')[0].msg, /valid MongoDB ObjectIds/);
});

test('rejects duplicate product ids', async () => {
  const { errors } = await run(validateCollectionCreate, { name: 'Picks', products: [A, B, A] });
  assert.match(errorsFor(errors, 'products')[0].msg, /duplicate/);
});

test('rejects more products than the cap allows', async () => {
  const products = Array.from({ length: COLLECTION_PRODUCTS_MAX + 1 }, (_, i) =>
    String(i).padStart(24, '0'),
  );
  const { errors } = await run(validateCollectionCreate, { name: 'Picks', products });
  assert.match(errorsFor(errors, 'products')[0].msg, /at most/);
});

test('rejects a non-http image', async () => {
  const { errors } = await run(validateCollectionCreate, {
    name: 'Picks',
    image: 'javascript:alert(1)',
  });
  assert.match(errorsFor(errors, 'image')[0].msg, /absolute http/);
});

test('rejects a negative or non-integer sortOrder', async () => {
  for (const sortOrder of [-1, 'abc']) {
    const { errors } = await run(validateCollectionCreate, { name: 'Picks', sortOrder });
    assert.ok(errorsFor(errors, 'sortOrder').length > 0, `${sortOrder} should be rejected`);
  }
});

test('rejects a slug containing spaces', async () => {
  const { errors } = await run(validateCollectionCreate, { name: 'Picks', slug: 'not a slug' });
  assert.ok(errorsFor(errors, 'slug').length > 0);
});
