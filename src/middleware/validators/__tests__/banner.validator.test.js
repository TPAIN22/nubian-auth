import test from 'node:test';
import assert from 'node:assert/strict';
import { validationResult } from 'express-validator';

import { validateBannerCreate, validateBannerUpdate } from '../banner.validator.js';

const OID = '507f1f77bcf86cd799439011';
const IMAGE = 'https://ik.imagekit.io/nubian/banner.png';

/**
 * Run a validator chain against a request body the way the router would, and
 * return both the errors and the sanitised body — the sanitiser is part of the
 * contract (it strips unknown keys before the controller persists the target).
 */
const run = async (chains, body) => {
  const req = { body, params: {}, query: {} };
  for (const chain of chains) await chain.run(req);
  const errors = validationResult(req);
  return { errors: errors.array(), body: req.body };
};

const targetErrors = (errors) => errors.filter((e) => e.path === 'target');

/* -------------------------------------------------------------------------- */
/* Accepted payloads                                                          */
/* -------------------------------------------------------------------------- */

test('accepts a banner with no target at all (backward compatible)', async () => {
  const { errors, body } = await run(validateBannerCreate, { image: IMAGE });
  assert.deepEqual(errors, []);
  assert.equal(body.target, undefined);
});

test('accepts every entity target type', async () => {
  for (const type of ['store', 'collection', 'product', 'category']) {
    const { errors, body } = await run(validateBannerCreate, {
      image: IMAGE,
      target: { type, id: OID },
    });
    assert.deepEqual(targetErrors(errors), [], `${type} should be accepted`);
    assert.deepEqual(body.target, { type, id: OID });
  }
});

test('accepts a url target', async () => {
  const { errors, body } = await run(validateBannerCreate, {
    image: IMAGE,
    target: { type: 'url', url: 'https://nubian-sd.com/eid-sale' },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(body.target, { type: 'url', url: 'https://nubian-sd.com/eid-sale' });
});

test('accepts an explicit none target', async () => {
  const { errors, body } = await run(validateBannerCreate, { image: IMAGE, target: { type: 'none' } });
  assert.deepEqual(errors, []);
  assert.deepEqual(body.target, { type: 'none' });
});

test('sanitises the target down to its canonical shape', async () => {
  const { body } = await run(validateBannerCreate, {
    image: IMAGE,
    target: { type: 'store', id: `  ${OID}  `, slug: 'ignored', extra: { a: 1 } },
  });
  assert.deepEqual(body.target, { type: 'store', id: OID });
});

/* -------------------------------------------------------------------------- */
/* Rejected payloads                                                          */
/* -------------------------------------------------------------------------- */

test('rejects an entity target with no id', async () => {
  const { errors } = await run(validateBannerCreate, { image: IMAGE, target: { type: 'store' } });
  assert.equal(targetErrors(errors).length, 1);
  assert.match(targetErrors(errors)[0].msg, /target\.id is required/);
});

test('rejects a url target that also carries an id', async () => {
  const { errors } = await run(validateBannerCreate, {
    image: IMAGE,
    target: { type: 'url', url: 'https://example.com', id: OID },
  });
  assert.match(targetErrors(errors)[0].msg, /must not carry an id/);
});

test('rejects an entity target that also carries a url', async () => {
  const { errors } = await run(validateBannerCreate, {
    image: IMAGE,
    target: { type: 'store', id: OID, url: 'https://example.com' },
  });
  assert.match(targetErrors(errors)[0].msg, /must not carry a url/);
});

test('rejects a url target with an unsafe scheme', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '/relative']) {
    const { errors } = await run(validateBannerCreate, { image: IMAGE, target: { type: 'url', url } });
    assert.equal(targetErrors(errors).length, 1, `${url} should be rejected`);
  }
});

test('rejects a url target with embedded credentials', async () => {
  const { errors } = await run(validateBannerCreate, {
    image: IMAGE,
    target: { type: 'url', url: 'https://accounts.google.com@evil.example/' },
  });
  assert.equal(targetErrors(errors).length, 1);
});

test('rejects an unknown target type', async () => {
  const { errors } = await run(validateBannerCreate, {
    image: IMAGE,
    target: { type: 'brand', id: OID },
  });
  assert.match(targetErrors(errors)[0].msg, /target\.type must be one of/);
});

test('rejects a non-ObjectId entity id', async () => {
  const { errors } = await run(validateBannerCreate, {
    image: IMAGE,
    target: { type: 'store', id: 'store_123' },
  });
  assert.match(targetErrors(errors)[0].msg, /valid MongoDB ObjectId/);
});

/* -------------------------------------------------------------------------- */
/* Banner fields around the target                                            */
/* -------------------------------------------------------------------------- */

test('create requires an absolute http(s) image URL', async () => {
  const missing = await run(validateBannerCreate, {});
  assert.ok(missing.errors.some((e) => e.path === 'image'));

  const relative = await run(validateBannerCreate, { image: '/uploads/x.png' });
  assert.ok(relative.errors.some((e) => e.path === 'image'));
});

test('update is a partial — isActive alone is valid and leaves target untouched', async () => {
  const { errors, body } = await run(validateBannerUpdate, { isActive: false });
  assert.deepEqual(errors, []);
  assert.equal(body.target, undefined);
  assert.equal(body.isActive, false);
});

test('update still validates a target when one is sent', async () => {
  const { errors } = await run(validateBannerUpdate, { target: { type: 'product' } });
  assert.equal(targetErrors(errors).length, 1);
});
