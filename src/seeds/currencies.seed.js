import mongoose from "mongoose";
import dotenv from "dotenv";
import Currency from "../models/currency.model.js";
import Country from "../models/country.model.js";
import logger from "../lib/logger.js";

dotenv.config();

/**
 * Seed currencies and update country default currencies
 * Run with: node src/seeds/currencies.seed.js
 */

const currencies = [
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
  },
  {
    code: "EGP",
    name: "Egyptian Pound",
    nameAr: "جنيه مصري",
    symbol: "EGP",
    symbolPosition: "after",
    isActive: true,
    decimals: 2,
    roundingStrategy: "NEAREST_10",
    sortOrder: 2,
    allowManualRate: false,
    manualRate: null,
  },
  {
    code: "SDG",
    name: "Sudanese Pound",
    nameAr: "جنيه سوداني",
    symbol: "SDG",
    symbolPosition: "after",
    isActive: true, // Enable for now, may need manual rate
    decimals: 0,
    roundingStrategy: "NEAREST_10",
    sortOrder: 3,
    allowManualRate: true, // Allow manual rate since Frankfurter may not support SDG
    manualRate: 1300, // Approximate rate - should be updated manually
    manualRateUpdatedAt: new Date(),
  },
  {
    code: "SAR",
    name: "Saudi Riyal",
    nameAr: "ريال سعودي",
    symbol: "ر.س",
    symbolPosition: "after",
    isActive: false, // Enable later
    decimals: 2,
    roundingStrategy: "ENDING_9",
    sortOrder: 4,
    allowManualRate: false,
    manualRate: null,
  },
];

const countryDefaultCurrencies = [
  { code: "SD", defaultCurrencyCode: "SDG" }, // Sudan
  { code: "EG", defaultCurrencyCode: "EGP" }, // Egypt
  { code: "SA", defaultCurrencyCode: "SAR" }, // Saudi Arabia
  { code: "AE", defaultCurrencyCode: "USD" }, // UAE
  { code: "US", defaultCurrencyCode: "USD" }, // USA
];

async function seedCurrencies() {
  try {
    logger.info("Starting currency seeding...");

    // Upsert currencies
    for (const currency of currencies) {
      await Currency.findOneAndUpdate(
        { code: currency.code },
        { $set: currency },
        { upsert: true, new: true }
      );
      logger.info(`✅ Seeded currency: ${currency.code} (${currency.name})`);
    }

    // Update country default currencies
    for (const mapping of countryDefaultCurrencies) {
      const result = await Country.findOneAndUpdate(
        { code: mapping.code },
        { $set: { defaultCurrencyCode: mapping.defaultCurrencyCode } },
        { new: true }
      );
      if (result) {
        logger.info(`✅ Updated country ${mapping.code} default currency: ${mapping.defaultCurrencyCode}`);
      } else {
        logger.warn(`⚠️ Country ${mapping.code} not found, skipping default currency update`);
      }
    }

    logger.info("🎉 Currency seeding completed successfully!");
    return { success: true, currenciesCount: currencies.length };
  } catch (error) {
    logger.error("❌ Currency seeding failed", { error: error.message });
    throw error;
  }
}

// Run when executed directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && (__filename === process.argv[1] || __filename.replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/'));

if (isMainModule) {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!MONGO_URI) {
    console.error("MONGODB_URI environment variable is required");
    process.exit(1);
  }

  mongoose.connect(MONGO_URI)
    .then(() => {
      console.log("Connected to MongoDB");
      return seedCurrencies();
    })
    .then(() => {
      console.log("Seeding completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Seeding failed:", error);
      process.exit(1);
    });
}

export { seedCurrencies };
