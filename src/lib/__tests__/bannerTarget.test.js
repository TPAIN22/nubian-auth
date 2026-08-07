import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BANNER_TARGET_TYPES,
  BANNER_TARGET_TYPES_UNSUPPORTED,
  BANNER_TARGET_URL_MAX,
  isSafeBannerUrl,
  normalizeBannerTarget,
  validateBannerTarget,
} from '../bannerTarget.js';

const OID = '507f1f77bcf86cd799439011';
const OTHER_OID = '507f191e810c19729de860ea';

/** Assert the target is accepted and normalises to exactly `expected`. */
const accepts = (input, expected) => {
  const result = validateBannerTarget(input);
  assert.equal(result.ok, true, `expected accept, got: ${result.message}`);
  assert.deepEqual(result.value, expected);
};

/** Assert the target is rejected, optionally checking the message mentions `hint`. */
const rejects = (input, hint) => {
  const result = validateBannerTarget(input);
  assert.equal(result.ok, false, `expected reject for ${JSON.stringify(input)}`);
  if (hint) assert.match(result.message, hint);
};

/* -------------------------------------------------------------------------- */
/* Valid targets                                                              */
/* -------------------------------------------------------------------------- */

test('accepts a store target', () => {
  accepts({ type: 'store', id: OID }, { type: 'store', id: OID });
});

test('accepts a product target', () => {
  accepts({ type: 'product', id: OID }, { type: 'product', id: OID });
});

test('accepts a category target', () => {
  accepts({ type: 'category', id: OID }, { type: 'category', id: OID });
});

test('accepts a collection target', () => {
  accepts({ type: 'collection', id: OID }, { type: 'collection', id: OID });
});

test('no target type is unsupported now that Collections exist', () => {
  // `collection` was the only entry while Collections were a schema
  // placeholder; the API creates them for real since the model landed.
  assert.deepEqual([...BANNER_TARGET_TYPES_UNSUPPORTED], []);
  assert.equal(BANNER_TARGET_TYPES_UNSUPPORTED.includes('collection'), false);
});

test('accepts a url target', () => {
  accepts(
    { type: 'url', url: 'https://example.com/sale?utm_source=app' },
    { type: 'url', url: 'https://example.com/sale?utm_source=app' },
  );
});

test('accepts a none target', () => {
  accepts({ type: 'none' }, { type: 'none' });
});

test('trims surrounding whitespace on id and url', () => {
  accepts({ type: 'store', id: `  ${OID}  ` }, { type: 'store', id: OID });
  accepts({ type: 'url', url: '  https://example.com  ' }, { type: 'url', url: 'https://example.com' });
});

test('drops unknown keys from the stored target', () => {
  accepts({ type: 'store', id: OID, slug: 'x', nested: { a: 1 } }, { type: 'store', id: OID });
});

/* -------------------------------------------------------------------------- */
/* Backward compatibility                                                     */
/* -------------------------------------------------------------------------- */

test('a banner with no target is valid and means none', () => {
  accepts(undefined, { type: 'none' });
  accepts(null, { type: 'none' });
});

test('a target with no type defaults to none', () => {
  accepts({}, { type: 'none' });
  accepts({ type: null }, { type: 'none' });
});

test('empty-string id/url on a none target are treated as absent', () => {
  // The dashboard clears a field by blanking it rather than deleting the key.
  accepts({ type: 'none', id: '', url: '' }, { type: 'none' });
});

test('normalizeBannerTarget never throws and degrades to none', () => {
  assert.deepEqual(normalizeBannerTarget(undefined), { type: 'none' });
  assert.deepEqual(normalizeBannerTarget({ type: 'store' }), { type: 'none' });
  assert.deepEqual(normalizeBannerTarget('garbage'), { type: 'none' });
  assert.deepEqual(normalizeBannerTarget({ type: 'store', id: OID }), { type: 'store', id: OID });
});

/* -------------------------------------------------------------------------- */
/* Invalid combinations                                                       */
/* -------------------------------------------------------------------------- */

test('rejects an entity target with a missing id', () => {
  for (const type of ['store', 'collection', 'product', 'category']) {
    rejects({ type }, /target\.id is required/);
  }
});

test('rejects an entity target with a non-ObjectId id', () => {
  rejects({ type: 'store', id: 'store_123' }, /valid MongoDB ObjectId/);
  rejects({ type: 'product', id: '123' }, /valid MongoDB ObjectId/);
  rejects({ type: 'category', id: `${OID}extra` }, /valid MongoDB ObjectId/);
});

test('rejects an entity target that also carries a url', () => {
  rejects({ type: 'store', id: OID, url: 'https://example.com' }, /must not carry a url/);
});

test('rejects a url target that also carries an id', () => {
  rejects({ type: 'url', url: 'https://example.com', id: OTHER_OID }, /must not carry an id/);
});

test('rejects a url target with no url', () => {
  rejects({ type: 'url' }, /target\.url is required/);
});

test('rejects a none target carrying an id or url', () => {
  rejects({ type: 'none', id: OID }, /must not carry an id or a url/);
  rejects({ type: 'none', url: 'https://example.com' }, /must not carry an id or a url/);
});

test('rejects an unknown target type', () => {
  rejects({ type: 'brand', id: OID }, /target\.type must be one of/);
  rejects({ type: 'external', url: 'https://example.com' }, /target\.type must be one of/);
});

test('rejects a non-object target', () => {
  rejects('store', /must be an object/);
  rejects(['store'], /must be an object/);
  rejects(42, /must be an object/);
});

/* -------------------------------------------------------------------------- */
/* URL safety                                                                 */
/* -------------------------------------------------------------------------- */

test('accepts absolute http and https URLs', () => {
  assert.equal(isSafeBannerUrl('https://nubian-sd.com/campaign'), true);
  assert.equal(isSafeBannerUrl('http://nubian-sd.com'), true);
});

test('rejects executable and local URL schemes', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    'sdnubian://product/123',
    'intent://scan#Intent;scheme=zxing;end',
  ]) {
    assert.equal(isSafeBannerUrl(url), false, `${url} should be rejected`);
    rejects({ type: 'url', url });
  }
});

test('rejects relative URLs', () => {
  assert.equal(isSafeBannerUrl('/campaign'), false);
  assert.equal(isSafeBannerUrl('example.com'), false);
});

test('rejects URLs with embedded credentials', () => {
  // Reads as accounts.google.com to a human, resolves to evil.example.
  assert.equal(isSafeBannerUrl('https://accounts.google.com@evil.example/'), false);
  assert.equal(isSafeBannerUrl('https://user:pass@example.com/'), false);
});

test('rejects an over-long URL', () => {
  const long = `https://example.com/${'a'.repeat(BANNER_TARGET_URL_MAX)}`;
  assert.equal(isSafeBannerUrl(long), false);
  rejects({ type: 'url', url: long });
});

/* -------------------------------------------------------------------------- */
/* Contract                                                                   */
/* -------------------------------------------------------------------------- */

test('the exported type list matches what the validator accepts', () => {
  assert.deepEqual(
    [...BANNER_TARGET_TYPES],
    ['none', 'store', 'collection', 'product', 'category', 'url'],
  );
  for (const type of BANNER_TARGET_TYPES) {
    const sample =
      type === 'none' ? { type } : type === 'url' ? { type, url: 'https://example.com' } : { type, id: OID };
    assert.equal(validateBannerTarget(sample).ok, true, `${type} should be accepted`);
  }
});
