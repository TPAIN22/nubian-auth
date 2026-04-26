import mongoose from "mongoose";
import dotenv from "dotenv";
import Currency from "../models/currency.model.js";
import Country from "../models/country.model.js";
import logger from "../lib/logger.js";

dotenv.config();

/**
 * Frankfurter API supported symbols (as of 2025).
 * Currencies NOT in this list must use allowManualRate: true.
 *
 * Supported: AUD BGN BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR
 *            ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY ZAR
 *            AED SAR EGP
 */

const currencies = [
  // ─── Base currency ──────────────────────────────────────────────────────────
  {
    code: "USD",
    name: "US Dollar",
    nameAr: "دولار أمريكي",
    symbol: "$",
    symbolPosition: "before",
    isActive: true,
    decimals: 2,
    roundingStrategy: "ENDING_9",
    sortOrder: 1,
    allowManualRate: false,
    manualRate: null,
    marketMarkupAdjustment: 0,
  },

  // ─── Primary markets ────────────────────────────────────────────────────────
  {
    code: "SDG",
    name: "Sudanese Pound",
    nameAr: "جنيه سوداني",
    symbol: "ج.س",
    symbolPosition: "after",
    isActive: true,
    decimals: 0,
    roundingStrategy: "NEAREST_10",
    sortOrder: 2,
    // Frankfurter does NOT support SDG — always manual
    allowManualRate: true,
    manualRate: 1300,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },
  {
    code: "EGP",
    name: "Egyptian Pound",
    nameAr: "جنيه مصري",
    symbol: "ج.م",
    symbolPosition: "after",
    isActive: true,
    decimals: 2,
    roundingStrategy: "NEAREST_1",
    sortOrder: 3,
    // Frankfurter supports EGP — use API, fallback to manual
    allowManualRate: true,
    manualRate: 50,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },

  // ─── Gulf markets (GCC) ─────────────────────────────────────────────────────
  {
    code: "SAR",
    name: "Saudi Riyal",
    nameAr: "ريال سعودي",
    symbol: "ر.س",
    symbolPosition: "after",
    isActive: false,
    decimals: 2,
    roundingStrategy: "NEAREST_1",
    sortOrder: 4,
    // Frankfurter does NOT support SAR (not in ECB data) — manual required
    // SAR is pegged to USD at a fixed rate of 3.75
    allowManualRate: true,
    manualRate: 3.75,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },
  {
    code: "AED",
    name: "UAE Dirham",
    nameAr: "درهم إماراتي",
    symbol: "د.إ",
    symbolPosition: "after",
    isActive: false,
    decimals: 2,
    roundingStrategy: "NEAREST_1",
    sortOrder: 5,
    // Frankfurter does NOT support AED (not in ECB data) — manual required
    // AED is pegged to USD at a fixed rate of 3.67
    allowManualRate: true,
    manualRate: 3.67,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },
  {
    code: "QAR",
    name: "Qatari Riyal",
    nameAr: "ريال قطري",
    symbol: "ر.ق",
    symbolPosition: "after",
    isActive: false,
    decimals: 2,
    roundingStrategy: "NEAREST_1",
    sortOrder: 6,
    // Frankfurter does NOT support QAR — manual required
    allowManualRate: true,
    manualRate: 3.64,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },
  {
    code: "KWD",
    name: "Kuwaiti Dinar",
    nameAr: "دينار كويتي",
    symbol: "د.ك",
    symbolPosition: "after",
    isActive: false,
    decimals: 3,
    roundingStrategy: "NONE",
    sortOrder: 7,
    // Frankfurter does NOT support KWD — manual required
    allowManualRate: true,
    manualRate: 0.307,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },
  {
    code: "BHD",
    name: "Bahraini Dinar",
    nameAr: "دينار بحريني",
    symbol: "د.ب",
    symbolPosition: "after",
    isActive: false,
    decimals: 3,
    roundingStrategy: "NONE",
    sortOrder: 8,
    // Frankfurter does NOT support BHD — manual required
    allowManualRate: true,
    manualRate: 0.377,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },
  {
    code: "OMR",
    name: "Omani Rial",
    nameAr: "ريال عُماني",
    symbol: "ر.ع",
    symbolPosition: "after",
    isActive: false,
    decimals: 3,
    roundingStrategy: "NONE",
    sortOrder: 9,
    // Frankfurter does NOT support OMR — manual required
    allowManualRate: true,
    manualRate: 0.385,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },

  // ─── Levant ─────────────────────────────────────────────────────────────────
  {
    code: "JOD",
    name: "Jordanian Dinar",
    nameAr: "دينار أردني",
    symbol: "د.أ",
    symbolPosition: "after",
    isActive: false,
    decimals: 3,
    roundingStrategy: "NONE",
    sortOrder: 10,
    // Frankfurter does NOT support JOD — manual required
    allowManualRate: true,
    manualRate: 0.709,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },

  // ─── North Africa ────────────────────────────────────────────────────────────
  {
    code: "LYD",
    name: "Libyan Dinar",
    nameAr: "دينار ليبي",
    symbol: "د.ل",
    symbolPosition: "after",
    isActive: false,
    decimals: 3,
    roundingStrategy: "NONE",
    sortOrder: 11,
    // Frankfurter does NOT support LYD — manual required
    allowManualRate: true,
    manualRate: 4.85,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },
  {
    code: "MAD",
    name: "Moroccan Dirham",
    nameAr: "درهم مغربي",
    symbol: "د.م",
    symbolPosition: "after",
    isActive: false,
    decimals: 2,
    roundingStrategy: "NEAREST_1",
    sortOrder: 12,
    // Frankfurter does NOT support MAD — manual required
    allowManualRate: true,
    manualRate: 9.95,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },
  {
    code: "DZD",
    name: "Algerian Dinar",
    nameAr: "دينار جزائري",
    symbol: "د.ج",
    symbolPosition: "after",
    isActive: false,
    decimals: 2,
    roundingStrategy: "NEAREST_10",
    sortOrder: 13,
    // Frankfurter does NOT support DZD — manual required
    allowManualRate: true,
    manualRate: 134.5,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },
  {
    code: "TND",
    name: "Tunisian Dinar",
    nameAr: "دينار تونسي",
    symbol: "د.ت",
    symbolPosition: "after",
    isActive: false,
    decimals: 3,
    roundingStrategy: "NONE",
    sortOrder: 14,
    // Frankfurter does NOT support TND — manual required
    allowManualRate: true,
    manualRate: 3.07,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },

  // ─── Other Arab markets ──────────────────────────────────────────────────────
  {
    code: "IQD",
    name: "Iraqi Dinar",
    nameAr: "دينار عراقي",
    symbol: "د.ع",
    symbolPosition: "after",
    isActive: false,
    decimals: 0,
    roundingStrategy: "NEAREST_10",
    sortOrder: 15,
    // Frankfurter does NOT support IQD — manual required
    allowManualRate: true,
    manualRate: 1310,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },
  {
    code: "YER",
    name: "Yemeni Rial",
    nameAr: "ريال يمني",
    symbol: "ر.ي",
    symbolPosition: "after",
    isActive: false,
    decimals: 0,
    roundingStrategy: "NEAREST_10",
    sortOrder: 16,
    // Frankfurter does NOT support YER — manual required
    allowManualRate: true,
    manualRate: 250,
    manualRateUpdatedAt: new Date(),
    marketMarkupAdjustment: 0,
  },

  // ─── International ──────────────────────────────────────────────────────────
  {
    code: "EUR",
    name: "Euro",
    nameAr: "يورو",
    symbol: "€",
    symbolPosition: "before",
    isActive: false,
    decimals: 2,
    roundingStrategy: "ENDING_9",
    sortOrder: 17,
    allowManualRate: false,
    manualRate: null,
    marketMarkupAdjustment: 0,
  },
  {
    code: "GBP",
    name: "British Pound",
    nameAr: "جنيه إسترليني",
    symbol: "£",
    symbolPosition: "before",
    isActive: false,
    decimals: 2,
    roundingStrategy: "ENDING_9",
    sortOrder: 18,
    allowManualRate: false,
    manualRate: null,
    marketMarkupAdjustment: 0,
  },
];

// ─── Country → default currency mapping ─────────────────────────────────────
const countryDefaultCurrencies = [
  { code: "SD", defaultCurrencyCode: "SDG" }, // Sudan
  { code: "EG", defaultCurrencyCode: "EGP" }, // Egypt
  { code: "SA", defaultCurrencyCode: "SAR" }, // Saudi Arabia
  { code: "AE", defaultCurrencyCode: "AED" }, // UAE
  { code: "QA", defaultCurrencyCode: "QAR" }, // Qatar
  { code: "KW", defaultCurrencyCode: "KWD" }, // Kuwait
  { code: "BH", defaultCurrencyCode: "BHD" }, // Bahrain
  { code: "OM", defaultCurrencyCode: "OMR" }, // Oman
  { code: "JO", defaultCurrencyCode: "JOD" }, // Jordan
  { code: "LY", defaultCurrencyCode: "LYD" }, // Libya
  { code: "MA", defaultCurrencyCode: "MAD" }, // Morocco
  { code: "DZ", defaultCurrencyCode: "DZD" }, // Algeria
  { code: "TN", defaultCurrencyCode: "TND" }, // Tunisia
  { code: "IQ", defaultCurrencyCode: "IQD" }, // Iraq
  { code: "YE", defaultCurrencyCode: "YER" }, // Yemen
  { code: "US", defaultCurrencyCode: "USD" }, // USA
  { code: "GB", defaultCurrencyCode: "GBP" }, // UK
  { code: "DE", defaultCurrencyCode: "EUR" }, // Germany (eurozone)
  { code: "FR", defaultCurrencyCode: "EUR" }, // France
];

// ─── Seed function ───────────────────────────────────────────────────────────
async function seedCurrencies() {
  try {
    logger.info("Starting currency seeding...");

    for (const currency of currencies) {
      await Currency.findOneAndUpdate(
        { code: currency.code },
        { $set: currency },
        { upsert: true, new: true }
      );
      const rateNote = currency.allowManualRate
        ? `manual rate: ${currency.manualRate}`
        : "API rate";
      logger.info(`✅ ${currency.code} — ${currency.name} (${rateNote})`);
    }

    logger.info(`\nUpdating country default currencies...`);
    for (const mapping of countryDefaultCurrencies) {
      const result = await Country.findOneAndUpdate(
        { code: mapping.code },
        { $set: { defaultCurrencyCode: mapping.defaultCurrencyCode } },
        { new: true }
      );
      if (result) {
        logger.info(`✅ ${mapping.code} → ${mapping.defaultCurrencyCode}`);
      } else {
        logger.warn(`⚠️  Country ${mapping.code} not found in DB — skipped`);
      }
    }

    logger.info(
      `\n🎉 Currency seeding done! ${currencies.length} currencies upserted.`
    );
    return { success: true, currenciesCount: currencies.length };
  } catch (error) {
    logger.error("❌ Currency seeding failed", { error: error.message });
    throw error;
  }
}

// ─── Run directly ────────────────────────────────────────────────────────────
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const isMainModule =
  process.argv[1] &&
  (__filename === process.argv[1] ||
    __filename.replace(/\\/g, "/") === process.argv[1].replace(/\\/g, "/"));

if (isMainModule) {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!MONGO_URI) {
    console.error("❌ MONGODB_URI environment variable is required");
    process.exit(1);
  }

  mongoose
    .connect(MONGO_URI)
    .then(() => {
      console.log("✅ Connected to MongoDB");
      return seedCurrencies();
    })
    .then(() => {
      console.log("✅ Seeding completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Seeding failed:", error.message);
      process.exit(1);
    });
}

export { seedCurrencies };
