import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    name: { type: String, trim: true, default: "" },

    // Location fields (new hierarchical structure)
    countryId: { type: mongoose.Schema.Types.ObjectId, ref: "Country" },
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: "City" },
    subCityId: { type: mongoose.Schema.Types.ObjectId, ref: "SubCity" },

    // Denormalized names for display (cached from location entities)
    countryName: { type: String, trim: true, default: "" },
    cityName: { type: String, trim: true, default: "" },
    subCityName: { type: String, trim: true, default: "" },

    // Legacy fields for backward compatibility
    city: { type: String, trim: true, default: "" },
    area: { type: String, trim: true, default: "" },

    street: { type: String, trim: true, default: "" },
    building: { type: String, trim: true, default: "" },

    phone: { type: String, trim: true, default: "" },

    // ✅ ADD THIS (fix checkout + store whatsapp)
    whatsapp: { type: String, trim: true, default: "" },

    notes: { type: String, trim: true, default: "" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Address", addressSchema);
