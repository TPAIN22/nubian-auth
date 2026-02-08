import mongoose from "mongoose";

/**
 * Currency Schema
 * Stores currency configurations for multi-currency support.
 * All product prices are stored in USD and converted to the user's selected currency.
 */
const currencySchema = new mongoose.Schema(
  {
    // ISO 4217 currency code (e.g., "USD", "EGP", "SDG", "SAR")
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    // English display name
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    // Arabic display name
    nameAr: {
      type: String,
      required: false,
      trim: true,
      maxlength: 100,
    },
    // Display symbol (e.g., "$", "EGP", "SDG", "ر.س")
    symbol: {
      type: String,
      required: true,
      trim: true,
      maxlength: 10,
    },
    // Symbol position: before or after the amount
    symbolPosition: {
      type: String,
      enum: ["before", "after"],
      default: "before",
    },
    // Whether this currency is available for selection
    isActive: {
      type: Boolean,
      default: false,
    },
    // Number of decimal places (usually 2, but some currencies use 0 or 3)
    decimals: {
      type: Number,
      default: 2,
      min: 0,
      max: 4,
    },
    // Psychological pricing strategy
    roundingStrategy: {
      type: String,
      enum: ["NONE", "NEAREST_1", "NEAREST_5", "NEAREST_10", "ENDING_9", "CUSTOM"],
      default: "NONE",
    },
    // For CUSTOM rounding: store custom rounding rules as JSON
    // Example: { "low": { "max": 10, "round": 0.99 }, "mid": { "max": 100, "round": 9.99 } }
    customRoundingRules: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Sort order for display in currency selection lists
    sortOrder: {
      type: Number,
      default: 0,
    },
    // Whether manual rate entry is allowed (for currencies not supported by FX provider)
    allowManualRate: {
      type: Boolean,
      default: false,
    },
    // Manual rate if set (used when FX provider doesn't support this currency)
    manualRate: {
      type: Number,
      default: null,
      min: 0,
    },
    // Date when manual rate was last updated
    manualRateUpdatedAt: {
      type: Date,
      default: null,
    },
    
    // Smart Pricing: Market-specific markup adjustment
    // This allows different base markup percentages based on currency/market
    // e.g., +5% for premium markets, -3% for price-sensitive markets
    // This adjustment is applied AFTER USD->currency conversion
    marketMarkupAdjustment: {
      type: Number,
      default: 0,
      min: -20, // Can reduce markup by up to 20%
      max: 30,  // Can increase markup by up to 30%
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
currencySchema.index({ code: 1 }, { unique: true });
currencySchema.index({ isActive: 1, sortOrder: 1 });

// Static method to get all active currencies for selection
currencySchema.statics.getActiveCurrencies = async function () {
  return this.find({ isActive: true })
    .sort({ sortOrder: 1, code: 1 })
    .select("-customRoundingRules -__v")
    .lean();
};

// Static method to get currency by code
currencySchema.statics.getByCode = async function (code) {
  return this.findOne({ code: code.toUpperCase() }).lean();
};

// Virtual for display format example
currencySchema.virtual("displayExample").get(function () {
  const amount = 1234.56;
  const formatted = amount.toFixed(this.decimals);
  return this.symbolPosition === "before"
    ? `${this.symbol}${formatted}`
    : `${formatted} ${this.symbol}`;
});

// Ensure virtuals are included in JSON output
currencySchema.set("toJSON", { virtuals: true });
currencySchema.set("toObject", { virtuals: true });

const Currency = mongoose.model("Currency", currencySchema);
export default Currency;
