/**
 * Run with:  node scripts/seed-currencies.js
 *
 * Creates or updates Currency documents with correct symbols, formatting rules,
 * and manual exchange rates for currencies not supported by Frankfurter/ECB
 * (SAR, AED, EGP, SDG, QAR, KWD, etc.).
 *
 * Safe to re-run: uses upsert so existing docs are only updated, not duplicated.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

// ── Schema (inline so the script is self-contained) ──────────────────────────
const currencySchema = new mongoose.Schema({
  code:                   { type: String, required: true, unique: true, uppercase: true },
  name:                   { type: String, required: true },
  nameAr:                 { type: String },
  symbol:                 { type: String, required: true },
  symbolPosition:         { type: String, enum: ['before', 'after'], default: 'before' },
  isActive:               { type: Boolean, default: true },
  decimals:               { type: Number, default: 2 },
  roundingStrategy:       { type: String, default: 'NONE' },
  sortOrder:              { type: Number, default: 0 },
  allowManualRate:        { type: Boolean, default: false },
  manualRate:             { type: Number, default: null },
  manualRateUpdatedAt:    { type: Date, default: null },
  marketMarkupAdjustment: { type: Number, default: 0 },
}, { timestamps: true });

const Currency = mongoose.models.Currency || mongoose.model('Currency', currencySchema);

// ── Currency definitions ──────────────────────────────────────────────────────
// manualRate = USD → currency  (e.g. 1 USD = 3.75 SAR)
// Frankfurter-supported currencies (EUR, GBP, etc.) still need a Currency doc
// for symbol/formatting — their rates come from ExchangeRate collection.
const CURRENCIES = [
  // ── Base ──────────────────────────────────────────────────────────────────
  { code: 'USD', name: 'US Dollar',          nameAr: 'دولار أمريكي',   symbol: '$',    symbolPosition: 'before', decimals: 2, sortOrder: 0,  allowManualRate: false, manualRate: null },

  // ── Middle East (manual rates required — not in ECB/Frankfurter) ──────────
  { code: 'SAR', name: 'Saudi Riyal',        nameAr: 'ريال سعودي',     symbol: 'ر.س',  symbolPosition: 'after',  decimals: 2, sortOrder: 10, allowManualRate: true,  manualRate: 3.75 },
  { code: 'AED', name: 'UAE Dirham',         nameAr: 'درهم إماراتي',   symbol: 'د.إ',  symbolPosition: 'after',  decimals: 2, sortOrder: 11, allowManualRate: true,  manualRate: 3.67 },
  { code: 'QAR', name: 'Qatari Riyal',       nameAr: 'ريال قطري',      symbol: 'ر.ق',  symbolPosition: 'after',  decimals: 2, sortOrder: 12, allowManualRate: true,  manualRate: 3.64 },
  { code: 'KWD', name: 'Kuwaiti Dinar',      nameAr: 'دينار كويتي',    symbol: 'د.ك',  symbolPosition: 'after',  decimals: 3, sortOrder: 13, allowManualRate: true,  manualRate: 0.31 },
  { code: 'BHD', name: 'Bahraini Dinar',     nameAr: 'دينار بحريني',   symbol: 'د.ب',  symbolPosition: 'after',  decimals: 3, sortOrder: 14, allowManualRate: true,  manualRate: 0.38 },
  { code: 'OMR', name: 'Omani Rial',         nameAr: 'ريال عُماني',    symbol: 'ر.ع',  symbolPosition: 'after',  decimals: 3, sortOrder: 15, allowManualRate: true,  manualRate: 0.38 },
  { code: 'JOD', name: 'Jordanian Dinar',    nameAr: 'دينار أردني',    symbol: 'د.أ',  symbolPosition: 'after',  decimals: 3, sortOrder: 16, allowManualRate: true,  manualRate: 0.71 },
  { code: 'EGP', name: 'Egyptian Pound',     nameAr: 'جنيه مصري',      symbol: 'ج.م',  symbolPosition: 'before', decimals: 2, sortOrder: 17, allowManualRate: true,  manualRate: 49.5 },
  { code: 'SDG', name: 'Sudanese Pound',     nameAr: 'جنيه سوداني',    symbol: 'ج.س',  symbolPosition: 'before', decimals: 2, sortOrder: 18, allowManualRate: true,  manualRate: 600  },
  { code: 'LYD', name: 'Libyan Dinar',       nameAr: 'دينار ليبي',     symbol: 'د.ل',  symbolPosition: 'after',  decimals: 3, sortOrder: 19, allowManualRate: true,  manualRate: 4.85 },
  { code: 'TND', name: 'Tunisian Dinar',     nameAr: 'دينار تونسي',    symbol: 'د.ت',  symbolPosition: 'after',  decimals: 3, sortOrder: 20, allowManualRate: true,  manualRate: 3.12 },
  { code: 'MAD', name: 'Moroccan Dirham',    nameAr: 'درهم مغربي',     symbol: 'د.م',  symbolPosition: 'after',  decimals: 2, sortOrder: 21, allowManualRate: true,  manualRate: 9.97 },
  { code: 'DZD', name: 'Algerian Dinar',     nameAr: 'دينار جزائري',   symbol: 'د.ج',  symbolPosition: 'after',  decimals: 2, sortOrder: 22, allowManualRate: true,  manualRate: 134  },

  // ── Europe (rates come from Frankfurter — doc needed for symbol/formatting) ─
  { code: 'EUR', name: 'Euro',               nameAr: 'يورو',            symbol: '€',    symbolPosition: 'before', decimals: 2, sortOrder: 30, allowManualRate: false, manualRate: null },
  { code: 'GBP', name: 'British Pound',      nameAr: 'جنيه إسترليني',  symbol: '£',    symbolPosition: 'before', decimals: 2, sortOrder: 31, allowManualRate: false, manualRate: null },
  { code: 'CHF', name: 'Swiss Franc',        nameAr: 'فرنك سويسري',    symbol: 'Fr',   symbolPosition: 'before', decimals: 2, sortOrder: 32, allowManualRate: false, manualRate: null },
  { code: 'TRY', name: 'Turkish Lira',       nameAr: 'ليرة تركية',     symbol: '₺',    symbolPosition: 'before', decimals: 2, sortOrder: 33, allowManualRate: false, manualRate: null },

  // ── Other major currencies ─────────────────────────────────────────────────
  { code: 'CAD', name: 'Canadian Dollar',    nameAr: 'دولار كندي',     symbol: 'CA$',  symbolPosition: 'before', decimals: 2, sortOrder: 40, allowManualRate: false, manualRate: null },
  { code: 'AUD', name: 'Australian Dollar',  nameAr: 'دولار أسترالي',  symbol: 'A$',   symbolPosition: 'before', decimals: 2, sortOrder: 41, allowManualRate: false, manualRate: null },
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  let created = 0;
  let updated = 0;

  for (const def of CURRENCIES) {
    const update = {
      name:                   def.name,
      nameAr:                 def.nameAr,
      symbol:                 def.symbol,
      symbolPosition:         def.symbolPosition,
      isActive:               true,
      decimals:               def.decimals,
      sortOrder:              def.sortOrder,
      allowManualRate:        def.allowManualRate,
      marketMarkupAdjustment: 0,
    };

    if (def.allowManualRate && def.manualRate != null) {
      update.manualRate = def.manualRate;
      update.manualRateUpdatedAt = new Date();
    }

    const result = await Currency.findOneAndUpdate(
      { code: def.code },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const wasNew = result.createdAt && (Date.now() - result.createdAt.getTime()) < 5000;
    if (wasNew) {
      console.log(`  ✓ Created  ${def.code}  (${def.name})${def.allowManualRate ? `  rate=${def.manualRate}` : '  rate=Frankfurter'}`);
      created++;
    } else {
      console.log(`  ↻ Updated  ${def.code}  (${def.name})${def.allowManualRate ? `  rate=${def.manualRate}` : '  rate=Frankfurter'}`);
      updated++;
    }
  }

  console.log(`\nDone. ${created} created, ${updated} updated.`);
  console.log('\nNext: restart the backend server so it picks up the new rates.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
