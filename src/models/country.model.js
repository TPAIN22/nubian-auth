import mongoose from "mongoose";

const countrySchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 3
    },
    nameAr: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    nameEn: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    isActive: {
      type: Boolean,
      default: true
    },
    // Default currency for this country (references Currency.code)
    defaultCurrencyCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 3,
      default: "USD"
    },
    sortOrder: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Indexes for performance
// Note: code already has unique: true which creates an index automatically
countrySchema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.model("Country", countrySchema);