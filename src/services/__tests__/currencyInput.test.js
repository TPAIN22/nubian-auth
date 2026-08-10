import test from 'node:test';
import assert from 'node:assert/strict';

import {
  usdFromRate,
  convertToUSD,
  MIN_MERCHANT_PRICE_USD,
} from '../currency.service.js';

/* ============================================================================
   Merchant price entry: foreign currency → the USD the platform stores.

   These pin the WRITE path. The read path (convertAndFormatPriceSync) is
   allowed to be clever — market markups, psychological rounding, a 1:1 fallback
   when a rate is missing. Every one of those behaviours is wrong here, and the
   failure mode of each is a merchant silently selling at the wrong price.

   convertToUSD takes an injected context precisely so this is testable without
   a database — the same property lets a caller convert a whole product's price,
   discount and cap against ONE rate.
   ========================================================================== */

const ctx = (over = {}) => ({
  code: 'SAR',
  rate: 3.75, // USD→SAR, pegged
  rateDate: '2026-08-10',
  provider: 'manual',
  decimals: 2,
  symbol: 'ر.س',
  ...over,
});

/* -------------------------------------------------------------------------- */
/* the arithmetic                                                             */
/* -------------------------------------------------------------------------- */

test('divides by the USD→currency rate', () => {
  assert.equal(usdFromRate(375, 3.75), 100);
});

test('handles a large-denomination currency', () => {
  // The case that motivated the feature: 60,000 SDG is $100, not $60,000.
  assert.equal(usdFromRate(60_000, 600), 100);
});

test('rounds to cents', () => {
  assert.equal(usdFromRate(100, 3.75), 26.67); // 26.6666…
  assert.equal(usdFromRate(10, 3), 3.33); // 3.3333…
});

test('USD passes through unchanged', () => {
  assert.equal(usdFromRate(49.99, 1), 49.99);
});

/* -------------------------------------------------------------------------- */
/* the rule the whole module exists to enforce                                */
/* -------------------------------------------------------------------------- */

test('applies the FX rate and NOTHING else — no psychological rounding', async () => {
  // 100 SAR at 3.75 is 26.67. If this ever returns 26.99, someone has routed
  // the write path through the read path's ENDING_9 strategy and every cost in
  // the catalogue is now inflated to a retail-looking number.
  const result = await convertToUSD(100, 'SAR', ctx());
  assert.equal(result.amountUSD, 26.67);
});

test('applies the FX rate and NOTHING else — no market markup', async () => {
  // A currency carrying marketMarkupAdjustment must not have it added on the
  // way in; the read path adds it on the way out, and doing both compounds it.
  const result = await convertToUSD(375, 'SAR', ctx({ marketMarkupAdjustment: 20 }));
  assert.equal(result.amountUSD, 100);
});

/* -------------------------------------------------------------------------- */
/* the audit block                                                            */
/* -------------------------------------------------------------------------- */

test('returns the rate actually used, so the price can be explained later', async () => {
  const result = await convertToUSD(375, 'SAR', ctx());

  assert.deepEqual(result, {
    amountUSD: 100,
    currency: 'SAR',
    amount: 375,
    rate: 3.75,
    rateDate: '2026-08-10',
    provider: 'manual',
  });
});

test('preserves what the merchant typed, not just the dollars', async () => {
  // Storing only the USD is what makes an edit screen show 372.4 next week
  // instead of the 375 the merchant entered.
  const result = await convertToUSD(375, 'SAR', ctx());
  assert.equal(result.amount, 375);
  assert.equal(result.currency, 'SAR');
});

/* -------------------------------------------------------------------------- */
/* refusals — every one of these is cheaper than a wrong price                 */
/* -------------------------------------------------------------------------- */

test('rejects a non-numeric amount', async () => {
  await assert.rejects(
    () => convertToUSD('abc', 'SAR', ctx()),
    (e) => e.code === 'INVALID_AMOUNT',
  );
});

test('rejects zero and negative amounts', async () => {
  await assert.rejects(
    () => convertToUSD(0, 'SAR', ctx()),
    (e) => e.code === 'INVALID_AMOUNT',
  );
  await assert.rejects(
    () => convertToUSD(-10, 'SAR', ctx()),
    (e) => e.code === 'INVALID_AMOUNT',
  );
});

test('rejects an amount that converts below the schema minimum', async () => {
  // 300 SDG at 600 is $0.50 — variantSchema.merchantPrice has min: 1, so the
  // save would fail deep in Mongoose. Fail early, and say it in the currency
  // the merchant actually typed.
  await assert.rejects(
    () => convertToUSD(300, 'SDG', ctx({ code: 'SDG', rate: 600 })),
    (e) => {
      assert.equal(e.code, 'BELOW_MINIMUM_PRICE');
      assert.match(e.message, /300 SDG/);
      assert.match(e.message, /\$0\.50/);
      return true;
    },
  );
});

test('accepts an amount landing exactly on the minimum', async () => {
  const result = await convertToUSD(600, 'SDG', ctx({ code: 'SDG', rate: 600 }));
  assert.equal(result.amountUSD, MIN_MERCHANT_PRICE_USD);
});
