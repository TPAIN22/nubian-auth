import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPricingCurrency, clearPricingInput } from '../pricingInput.js';

/* ============================================================================
   Rewriting a product payload from the merchant's currency into stored USD.

   The failure mode this guards is not a crash — it is a product that saves
   cleanly at the wrong price. So the tests are mostly about which fields are
   money and which only look like money.
   ========================================================================== */

const sarContext = (over = {}) => ({
  code: 'SAR',
  rate: 3.75,
  rateDate: '2026-08-10',
  provider: 'manual',
  decimals: 2,
  symbol: 'ر.س',
  ...over,
});

const payload = (over = {}) => ({
  name: 'Test Product',
  variants: [{ sku: 'A-1', attributes: { size: 'M' }, merchantPrice: 375, stock: 5 }],
  ...over,
});

/* -------------------------------------------------------------------------- */
/* the conversion                                                             */
/* -------------------------------------------------------------------------- */

test('converts every variant price to USD', () => {
  const body = applyPricingCurrency(payload(), sarContext());
  assert.equal(body.variants[0].merchantPrice, 100);
});

test('converts a variant discount at the same rate as its price', () => {
  const body = applyPricingCurrency(
    payload({
      variants: [{ sku: 'A-1', attributes: { s: 'M' }, merchantPrice: 375, merchantDiscount: 75, stock: 1 }],
    }),
    sarContext(),
  );

  assert.equal(body.variants[0].merchantPrice, 100);
  assert.equal(body.variants[0].merchantDiscount, 20);
});

test('USD payloads are returned untouched, with no audit block', () => {
  const body = applyPricingCurrency(payload(), sarContext({ code: 'USD', rate: 1 }));

  assert.equal(body.variants[0].merchantPrice, 375);
  assert.equal(body.pricingInput, undefined);
  assert.equal(body.variants[0].pricingInput, undefined);
});

/* -------------------------------------------------------------------------- */
/* money vs. not-money — the expensive mistakes                               */
/* -------------------------------------------------------------------------- */

test('a PERCENTAGE discount is never converted', () => {
  // 20% converted at 3.75 would become 75% off. The merchant authored a fifth
  // off; they would be giving away three quarters.
  const body = applyPricingCurrency(
    payload({ discount: { type: 'percentage', value: 20, isActive: true } }),
    sarContext(),
  );

  assert.equal(body.discount.value, 20);
  assert.equal(body.pricingInput.discountValue, null);
});

test('a FIXED discount is converted', () => {
  const body = applyPricingCurrency(
    payload({ discount: { type: 'fixed', value: 75, isActive: true } }),
    sarContext(),
  );

  assert.equal(body.discount.value, 20);
  assert.equal(body.pricingInput.discountValue, 75);
});

test('maxDiscount is money even on a percentage discount', () => {
  // "20% off, capped at 75 riyals" — the percentage stays, the cap converts.
  const body = applyPricingCurrency(
    payload({ discount: { type: 'percentage', value: 20, maxDiscount: 75, isActive: true } }),
    sarContext(),
  );

  assert.equal(body.discount.value, 20);
  assert.equal(body.discount.maxDiscount, 20);
  assert.equal(body.pricingInput.discountMaxDiscount, 75);
});

test('markups are percentages and pass through', () => {
  const body = applyPricingCurrency(
    payload({
      variants: [{ sku: 'A-1', attributes: { s: 'M' }, merchantPrice: 375, nubianMarkup: 15, dynamicMarkup: 5, stock: 1 }],
    }),
    sarContext(),
  );

  assert.equal(body.variants[0].nubianMarkup, 15);
  assert.equal(body.variants[0].dynamicMarkup, 5);
});

/* -------------------------------------------------------------------------- */
/* the audit block                                                            */
/* -------------------------------------------------------------------------- */

test('records what the merchant typed, so an edit screen can show it back', () => {
  const body = applyPricingCurrency(
    payload({
      variants: [{ sku: 'A-1', attributes: { s: 'M' }, merchantPrice: 375, merchantDiscount: 75, stock: 1 }],
    }),
    sarContext(),
  );

  assert.deepEqual(body.variants[0].pricingInput, {
    merchantPrice: 375,
    merchantDiscount: 75,
  });
  assert.equal(body.pricingInput.currency, 'SAR');
  assert.equal(body.pricingInput.rate, 3.75);
  assert.equal(body.pricingInput.rateDate, '2026-08-10');
  assert.equal(body.pricingInput.provider, 'manual');
  assert.ok(body.pricingInput.lockedAt instanceof Date);
});

test('one rate is used for the whole product', () => {
  // Every field must trace back to the SAME rate — that is the entire reason
  // the context is passed in rather than resolved per field.
  const body = applyPricingCurrency(
    payload({
      variants: [
        { sku: 'A-1', attributes: { s: 'M' }, merchantPrice: 375, stock: 1 },
        { sku: 'A-2', attributes: { s: 'L' }, merchantPrice: 750, stock: 1 },
      ],
      discount: { type: 'fixed', value: 37.5, isActive: true },
    }),
    sarContext(),
  );

  assert.equal(body.variants[0].merchantPrice, 100);
  assert.equal(body.variants[1].merchantPrice, 200);
  assert.equal(body.discount.value, 10);
});

test('clearPricingInput blanks a product going back to USD', () => {
  // Without this, a product re-priced in dollars keeps its old SAR block and
  // the edit screen shows a number in a currency no longer in use.
  const body = clearPricingInput(
    applyPricingCurrency(payload(), sarContext()),
  );

  assert.equal(body.pricingInput.currency, null);
  assert.equal(body.pricingInput.rate, null);
  assert.deepEqual(body.variants[0].pricingInput, {
    merchantPrice: null,
    merchantDiscount: null,
  });
});

/* -------------------------------------------------------------------------- */
/* refusals                                                                   */
/* -------------------------------------------------------------------------- */

test('names the offending variant when a price converts below the minimum', () => {
  assert.throws(
    () =>
      applyPricingCurrency(
        payload({ variants: [{ sku: 'CHEAP-1', attributes: { s: 'M' }, merchantPrice: 300, stock: 1 }] }),
        sarContext({ code: 'SDG', rate: 600 }),
      ),
    (e) => {
      assert.equal(e.code, 'BELOW_MINIMUM_PRICE');
      assert.match(e.message, /CHEAP-1/);
      assert.deepEqual(e.details, [{ field: 'merchantPrice', sku: 'CHEAP-1' }]);
      return true;
    },
  );
});

test('rejects a variant with a non-positive price', () => {
  assert.throws(
    () =>
      applyPricingCurrency(
        payload({ variants: [{ sku: 'BAD-1', attributes: { s: 'M' }, merchantPrice: 0, stock: 1 }] }),
        sarContext(),
      ),
    (e) => e.code === 'INVALID_AMOUNT',
  );
});

test('refuses to convert without a usable rate', () => {
  assert.throws(
    () => applyPricingCurrency(payload(), sarContext({ rate: 0 })),
    (e) => e.code === 'RATE_UNAVAILABLE',
  );
});
