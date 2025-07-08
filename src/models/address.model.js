import mongoose from "mongoose";
const addressSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: String,
  city: String,
  area: String,
  street: String,
  building: String,
  phone: String,
  notes: String,
  isDefault: { type: Boolean, default: false }
});
export default mongoose.model("Address", addressSchema); 