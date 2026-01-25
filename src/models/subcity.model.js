import mongoose from "mongoose";

const subCitySchema = new mongoose.Schema(
  {
    cityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "City",
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
subCitySchema.index({ cityId: 1, sortOrder: 1 });
subCitySchema.index({ cityId: 1, isActive: 1 });

export default mongoose.model("SubCity", subCitySchema);