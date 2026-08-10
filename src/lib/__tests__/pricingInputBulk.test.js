import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPricingCurrency } from '../pricingInput.js';

/* ============================================================================
   Bulk import: many rows, several currencies, ONE rate each.

   The controller resolves each distinct currency once before the row loop and
   then applies the pure transform per row. These tests pin the properties that
   arrangement is supposed to buy, since the loop itself is not unit-testable
   without a database.
   ========================================================================== */

const ctx = (code, rate) => ({
  code,
  rate,
  rateDate: '2026-08-10',
  provider: 'manual',
  decimals: 2,
  symbol: code,
});

const row = (over = {}) => ({
  importSku: 'ROW-1',
  name: 'Row',
  variants: [{ sku: 'ROW-1', attributes: { default: 'default' }, merchantPrice: 375, stock: 3 }],
  ...over,
});

test('rows sharing a currency share one rate', () => {
  // The reason the context is hoisted out of the loop: a long import must not
  // straddle the 4 AM FX refresh and price half a catalogue at each rate.
  const sar = ctx('SAR', 3.75);

  const a = applyPricingCurrency(row({ importSku: 'A' }), sar);
  const b = applyPricingCurrency(row({ importSku: 'B' }), sar);

  assert.equal(a.variants[0].merchantPrice, 100);
  assert.equal(b.variants[0].merchantPrice, 100);
  assert.equal(a.pricingInput.rate, b.pricingInput.rate);
  assert.equal(a.pricingInput.rateDate, b.pricingInput.rateDate);
});

test('rows in different currencies convert independently', () => {
  const sarRow = applyPricingCurrency(row(), ctx('SAR', 3.75));
  const sdgRow = applyPricingCurrency(
    row({ variants: [{ sku: 'R2', attributes: { d: 'd' }, merchantPrice: 60_000, stock: 1 }] }),
    ctx('SDG', 600),
  );

  assert.equal(sarRow.variants[0].merchantPrice, 100);
  assert.equal(sdgRow.variants[0].merchantPrice, 100);
  assert.equal(sarRow.pricingInput.currency, 'SAR');
  assert.equal(sdgRow.pricingInput.currency, 'SDG');
});

test('a USD row is left alone and stamps no audit block', () => {
  // Load-bearing for the importer's upsert: the controller only $sets
  // pricingInput when the row produced one. A USD re-import of a product first
  // priced in SAR must not blank its audit trail.
  const usd = applyPricingCurrency(row(), ctx('USD', 1));

  assert.equal(usd.variants[0].merchantPrice, 375);
  assert.equal(usd.pricingInput, undefined);
  assert.equal(usd.variants[0].pricingInput, undefined);
});

test('multi-variant rows convert every variant at the row rate', () => {
  const out = applyPricingCurrency(
    row({
      variants: [
        { sku: 'V-S', attributes: { size: 'S' }, merchantPrice: 375, stock: 1 },
        { sku: 'V-M', attributes: { size: 'M' }, merchantPrice: 750, merchantDiscount: 37.5, stock: 2 },
      ],
    }),
    ctx('SAR', 3.75),
  );

  assert.equal(out.variants[0].merchantPrice, 100);
  assert.equal(out.variants[1].merchantPrice, 200);
  assert.equal(out.variants[1].merchantDiscount, 10);
  assert.deepEqual(out.variants[1].pricingInput, {
    merchantPrice: 750,
    merchantDiscount: 37.5,
  });
});

test('each variant keeps its typed amount for the round trip', () => {
  // The controller rebuilds variant objects field by field rather than
  // spreading, so pricingInput has to be carried across explicitly. If that is
  // ever dropped, an imported foreign-currency product silently stops
  // round-tripping and the edit screen shows converted dollars under a SAR
  // label — the original bug, reintroduced through the back door.
  const out = applyPricingCurrency(row(), ctx('SAR', 3.75));
  assert.equal(out.variants[0].pricingInput.merchantPrice, 375);
});
