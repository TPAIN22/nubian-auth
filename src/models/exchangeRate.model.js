import mongoose from "mongoose";

/**
 * ExchangeRate Schema
 * Stores daily exchange rates fetched from FX provider.
 * Base currency is always USD.
 * One document per provider + date combination.
 */
const exchangeRateSchema = new mongoose.Schema(
  {
    // Base currency (always "USD" for this implementation)
    base: {
      type: String,
      required: true,
      default: "USD",
      uppercase: true,
      trim: true,
    },
    // Date of the rates from provider (YYYY-MM-DD format)
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    // Map of currency code to exchange rate
    // Example: { "EGP": 49.23, "SAR": 3.75, "GBP": 0.79 }
    rates: {
      type: Map,
      of: Number,
      required: true,
      default: {},
    },
    // When we fetched these rates from the provider
    fetchedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // Provider name for audit trail
    provider: {
      type: String,
      required: true,
      default: "frankfurter",
      enum: ["frankfurter", "manual"],
    },
    // Whether this was a successful fetch or had errors
    fetchStatus: {
      type: String,
      enum: ["success", "partial", "failed"],
      default: "success",
    },
    // Any errors encountered during fetch
    fetchErrors: {
      type: [String],
      default: [],
    },
    // Which currencies were requested but not returned by provider
    missingCurrencies: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index to prevent duplicate entries for same provider + date
exchangeRateSchema.index({ base: 1, date: 1, provider: 1 }, { unique: true });

// Index for finding latest rates quickly
exchangeRateSchema.index({ fetchedAt: -1 });
exchangeRateSchema.index({ provider: 1, date: -1 });

// Static method to get the latest exchange rates
exchangeRateSchema.statics.getLatest = async function (provider = "frankfurter") {
  return this.findOne({ provider })
    .sort({ date: -1, fetchedAt: -1 })
    .lean();
};

// Static method to get rate for a specific currency from latest rates
exchangeRateSchema.statics.getLatestRate = async function (currencyCode, provider = "frankfurter") {
  const latest = await this.getLatest(provider);
  if (!latest || !latest.rates) return null;
  
  // If USD, rate is always 1
  if (currencyCode.toUpperCase() === "USD") return 1;
  
  // Get rate from Map (handles both Map and plain object)
  const rates = latest.rates instanceof Map ? latest.rates : new Map(Object.entries(latest.rates));
  return rates.get(currencyCode.toUpperCase()) || null;
};

// Static method to get rates for multiple currencies
exchangeRateSchema.statics.getLatestRates = async function (currencyCodes, provider = "frankfurter") {
  const latest = await this.getLatest(provider);
  if (!latest || !latest.rates) return {};
  
  const rates = latest.rates instanceof Map ? latest.rates : new Map(Object.entries(latest.rates));
  const result = { USD: 1 }; // USD is always 1
  
  for (const code of currencyCodes) {
    const upperCode = code.toUpperCase();
    if (upperCode === "USD") continue;
    const rate = rates.get(upperCode);
    if (rate !== undefined) {
      result[upperCode] = rate;
    }
  }
  
  return result;
};

// Static method to upsert rates (idempotent - safe to call multiple times)
exchangeRateSchema.statics.upsertRates = async function ({
  base = "USD",
  date,
  rates,
  provider = "frankfurter",
  fetchStatus = "success",
  fetchErrors = [],
  missingCurrencies = [],
}) {
  return this.findOneAndUpdate(
    { base, date, provider },
    {
      $set: {
        rates,
        fetchedAt: new Date(),
        fetchStatus,
        fetchErrors,
        missingCurrencies,
      },
    },
    { upsert: true, new: true }
  );
};

// Instance method to get a specific rate
exchangeRateSchema.methods.getRate = function (currencyCode) {
  if (currencyCode.toUpperCase() === "USD") return 1;
  const rates = this.rates instanceof Map ? this.rates : new Map(Object.entries(this.rates));
  return rates.get(currencyCode.toUpperCase()) || null;
};

// Transform for JSON output - convert Map to plain object
exchangeRateSchema.set("toJSON", {
  transform: function (doc, ret) {
    if (ret.rates instanceof Map) {
      ret.rates = Object.fromEntries(ret.rates);
    }
    return ret;
  },
});

exchangeRateSchema.set("toObject", {
  transform: function (doc, ret) {
    if (ret.rates instanceof Map) {
      ret.rates = Object.fromEntries(ret.rates);
    }
    return ret;
  },
});

const ExchangeRate = mongoose.model("ExchangeRate", exchangeRateSchema);
export default ExchangeRate;
