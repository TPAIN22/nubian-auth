import mongoose from "mongoose";

const citySchema = new mongoose.Schema(
  {
    countryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Country",
      required: true
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
citySchema.index({ countryId: 1, sortOrder: 1 });
citySchema.index({ countryId: 1, isActive: 1 });

export default mongoose.model("City", citySchema);