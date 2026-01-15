import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    name: { type: String, trim: true, default: "" },
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
