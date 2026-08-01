import mongoose from "mongoose";
import crypto from "crypto";

// Admin-created stores exist before their owner has a Clerk account, but userId
// is required+unique and is read as a Clerk id all over the codebase. A synthetic
// prefixed id keeps both constraints intact and is impossible to confuse with a
// real Clerk id — a nullable userId would make `Merchant.findOne({ userId })`
// match arbitrary rows whenever userId came through undefined.
export const UNCLAIMED_USER_ID_PREFIX = 'unclaimed:';
export const buildUnclaimedUserId = () =>
  `${UNCLAIMED_USER_ID_PREFIX}${crypto.randomUUID()}`;
export const isUnclaimedUserId = (userId) =>
  typeof userId === 'string' && userId.startsWith(UNCLAIMED_USER_ID_PREFIX);

const merchantSchema = new mongoose.Schema(
  {
    // ── Identity (matches merchantapplications collection) ─────────────────
    userId:       { type: String, required: true, unique: true, index: true }, // Clerk userId, or `unclaimed:<uuid>` placeholder
    storeName:    { type: String, required: true },
    ownerName:    { type: String, required: true },
    // phone / nationalId / iban are NOT model-required: an admin creating a store
    // on a merchant's behalf has none of them yet. The apply path still enforces
    // all three (validateMerchantApplication + applyToBecomeMerchant), so making
    // them model-required only adds a save-time throw when an admin links an
    // owner to a store that legitimately lacks payout details. Use the
    // `profileComplete` virtual to gate anything that actually needs them.
    phone:        { type: String },
    email:        { type: String, required: true, lowercase: true, trim: true },
    merchantType: { type: String, enum: ['individual', 'business'], required: true },
    nationalId:   { type: String },
    crNumber:     { type: String },
    iban:         { type: String },
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

    // ── Ownership claim (admin-created stores) ─────────────────────────────
    // 'unclaimed' means an admin built this store (and possibly its products)
    // before the owner had an account. Products reference Merchant._id, which
    // never changes, so claiming is a one-field write with no data migration.
    claimStatus: {
      type: String,
      enum: ['unclaimed', 'claimed'],
      default: 'claimed',
      index: true,
    },
    claimedAt:      { type: Date },
    claimedBy:      { type: String, default: null }, // Clerk userId of the admin who linked the owner
    createdByAdmin: { type: String, default: null }, // Clerk userId of the admin who created the store

    // Set when a registered user applies with an email that matches an unclaimed
    // store. Never auto-links — it only surfaces the match for an admin to confirm.
    claimRequestedBy: { type: String, default: null }, // Clerk userId of the applicant
    claimRequestedAt: { type: Date },

    // ── Auth-backend extras (not in dashboard schema, safe to add) ─────────
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    balance:       { type: Number, default: 0, min: 0 },
    frozenBalance: { type: Number, default: 0, min: 0 },
    isFlagged:     { type: Boolean, default: false },
    flaggedAt:     { type: Date },
    flagReason:    { type: String },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// True once the store carries everything payouts and compliance need. Admin-created
// stores start false and stay false until the claiming owner fills the gaps in.
merchantSchema.virtual('profileComplete').get(function () {
  return Boolean(this.phone && this.nationalId && this.iban);
});

merchantSchema.index({ email: 1 });
// Claim lookup: find the unclaimed store waiting for a given email.
merchantSchema.index({ claimStatus: 1, email: 1 });
merchantSchema.index({ status: 1, createdAt: -1 });
merchantSchema.index({ status: 1, approvedAt: -1 });

// Third arg locks the collection name — data lives in merchantapplications
const Merchant = mongoose.model("Merchant", merchantSchema, "merchantapplications");
export default Merchant;
