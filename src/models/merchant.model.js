import mongoose from "mongoose";

const merchantSchema = new mongoose.Schema(
  {
    // ── Identity (matches merchantapplications collection) ─────────────────
    userId:       { type: String, required: true, unique: true, index: true }, // Clerk userId
    storeName:    { type: String, required: true },
    ownerName:    { type: String, required: true },
    phone:        { type: String, required: true },
    email:        { type: String, required: true },
    merchantType: { type: String, enum: ['individual', 'business'], required: true },
    nationalId:   { type: String, required: true },
    crNumber:     { type: String },
    iban:         { type: String, required: true },
    logoUrl:      { type: String },
    banner:       { type: String },
    description:  { type: String, required: true },
    categories:   [{ type: String }],
    city:         { type: String, required: true },
    productSamples: [{ type: String }],

    // ── Status ─────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'needs_revision', 'suspended'],
      default: 'pending',
      index: true,
    },
    rejectionReason:  { type: String },
    revisionNotes:    { type: String },
    suspensionReason: { type: String },
    suspendedAt:      { type: Date },
    approvedAt:       { type: Date },
    approvedBy: { type: String, default: null }, // Clerk userId of the admin who approved

    // ── Auth-backend extras (not in dashboard schema, safe to add) ─────────
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    balance:       { type: Number, default: 0, min: 0 },
    frozenBalance: { type: Number, default: 0, min: 0 },
    isFlagged:     { type: Boolean, default: false },
    flaggedAt:     { type: Date },
    flagReason:    { type: String },
  },
  { timestamps: true }
);

merchantSchema.index({ email: 1 });
merchantSchema.index({ status: 1, createdAt: -1 });
merchantSchema.index({ status: 1, approvedAt: -1 });

// Third arg locks the collection name — data lives in merchantapplications
const Merchant = mongoose.model("Merchant", merchantSchema, "merchantapplications");
export default Merchant;
