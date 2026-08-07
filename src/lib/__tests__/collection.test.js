import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLLECTION_PRODUCTS_MAX,
  orderByIds,
  slugify,
  validateCollectionProducts,
} from '../collection.js';

const A = '507f1f77bcf86cd799439011';
const B = '507f191e810c19729de860ea';
const C = '5f8d0d55b54764421b7156c3';

const accepts = (input, expected) => {
  const result = validateCollectionProducts(input);
  assert.equal(result.ok, true, `expected accept, got: ${result.message}`);
  assert.deepEqual(result.value, expected);
};

const rejects = (input, hint) => {
  const result = validateCollectionProducts(input);
  assert.equal(result.ok, false, `expected reject for ${JSON.stringify(input)}`);
  if (hint) assert.match(result.message, hint);
};

/* -------------------------------------------------------------------------- */
/* products                                                                   */
/* -------------------------------------------------------------------------- */

test('accepts an ordered list of product ids and preserves the order', () => {
  accepts([C, A, B], [C, A, B]);
});

test('a missing or empty product list is valid — an empty collection is legal', () => {
  accepts(undefined, []);
  accepts(null, []);
  accepts([], []);
});

test('unwraps option objects from the dashboard picker', () => {
  accepts([{ _id: A }, { id: B }], [A, B]);
});

test('trims surrounding whitespace on ids', () => {
  accepts([`  ${A}  `], [A]);
});

test('rejects a duplicate product id rather than silently collapsing it', () => {
  // Collapsing would renumber the sequence the admin just arranged, so this is
  // an error they have to resolve.
  rejects([A, B, A], /duplicate/);
});

test('rejects a non-ObjectId entry', () => {
  rejects([A, 'product_1'], /valid MongoDB ObjectIds/);
  rejects([null], /valid MongoDB ObjectIds/);
  rejects([{ name: 'no id here' }], /valid MongoDB ObjectIds/);
});

test('rejects a products value that is not an array', () => {
  rejects(A, /must be an array/);
  rejects({ 0: A }, /must be an array/);
});

test('rejects a list longer than the cap', () => {
  const tooMany = Array.from({ length: COLLECTION_PRODUCTS_MAX + 1 }, (_, i) =>
    String(i).padStart(24, '0'),
  );
  rejects(tooMany, /at most/);
  // Exactly at the cap is fine.
  assert.equal(validateCollectionProducts(tooMany.slice(0, COLLECTION_PRODUCTS_MAX)).ok, true);
});

/* -------------------------------------------------------------------------- */
/* slugify                                                                    */
/* -------------------------------------------------------------------------- */

test('slugifies an ASCII name', () => {
  assert.equal(slugify('Ramadan Favorites'), 'ramadan-favorites');
  assert.equal(slugify('  Best   Sellers!!  '), 'best-sellers');
  assert.equal(slugify('New / Arrivals'), 'new-arrivals');
});

test('keeps Arabic letters instead of collapsing to an empty slug', () => {
  // The dashboard is Arabic-first; an ASCII-only slugifier would return ''
  // here and every collection would fall back to the same default handle.
  assert.equal(slugify('مفضلات رمضان'), 'مفضلات-رمضان');
});

test('slugify never returns leading, trailing or doubled hyphens', () => {
  assert.equal(slugify('---hello---world---'), 'hello-world');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify(undefined), '');
});

/* -------------------------------------------------------------------------- */
/* orderByIds                                                                 */
/* -------------------------------------------------------------------------- */

test('projects documents back onto the curated order', () => {
  const docs = [{ _id: B }, { _id: A }, { _id: C }];
  assert.deepEqual(orderByIds([A, B, C], docs), [{ _id: A }, { _id: B }, { _id: C }]);
});

test('drops missing documents without reordering the survivors', () => {
  // [A, B, C, D] with B deleted must return [A, C, D] — not [A, C, D] sorted
  // some other way, and not a gap.
  const docs = [{ _id: C }, { _id: A }];
  assert.deepEqual(orderByIds([A, B, C], docs), [{ _id: A }, { _id: C }]);
});

test('handles an empty curated list and an empty document set', () => {
  assert.deepEqual(orderByIds([], [{ _id: A }]), []);
  assert.deepEqual(orderByIds([A], []), []);
});
