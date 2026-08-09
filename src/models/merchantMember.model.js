import mongoose from 'mongoose';

// Who may act on behalf of a store.
//
// Until this collection existed, "runs the store" was a single field:
// Merchant.userId, unique-indexed, resolved on every request via
// Merchant.findOne({ userId }). That made a store and its owner the same row,
// so a store could never have a second staff member.
//
// This is the join table that separates the two. Everything downstream of a
// store already references Merchant._id — products, coupons, push tokens,
// notifications, orders — so nothing about the store's data moves; only the
// path from a Clerk user to a Merchant._id changes.
//
// One row per (merchant, person), for the lifetime of the relationship. Revoking
// flips `status` rather than deleting, and re-inviting the same person reuses
// the row — which is what makes the unique indexes below safe and keeps an
// audit trail of who was let in and when.

export const MERCHANT_ROLES = ['owner', 'manager', 'staff'];
export const MEMBER_STATUSES = ['invited', 'active', 'revoked'];

const merchantMemberSchema = new mongoose.Schema(
  {
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      required: true,
      index: true,
    },

    // Clerk userId. Null while an invite is outstanding — the invitee may not
    // have an account yet, which is the whole reason invites are matched by
    // email and only bound to a userId at accept time.
    userId: { type: String, default: null },

    // The invite target, and the key an accepting user is matched on. Always
    // set, including for owners (backfilled from Merchant.email).
    email: { type: String, required: true, lowercase: true, trim: true },

    role: {
      type: String,
      enum: MERCHANT_ROLES,
      required: true,
      default: 'staff',
    },

    status: {
      type: String,
      enum: MEMBER_STATUSES,
      required: true,
      default: 'invited',
      index: true,
    },

    // ── Audit ───────────────────────────────────────────────────────────────
    invitedBy:  { type: String, default: null }, // Clerk userId of the inviter
    invitedAt:  { type: Date },
    acceptedAt: { type: Date },
    revokedBy:  { type: String, default: null }, // Clerk userId of the revoker
    revokedAt:  { type: Date },
  },
  { timestamps: true }
);

// Hot path: resolve the caller's stores on every merchant-scoped request.
merchantMemberSchema.index({ userId: 1, status: 1 });

// One membership per person per store. Partial on $type so the many rows with a
// null userId (outstanding invites) don't collide with each other — a plain
// `sparse` compound index would still index them, because sparse only skips a
// document missing *every* indexed field.
merchantMemberSchema.index(
  { merchant: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: 'string' } } }
);

// One membership per email per store, so re-inviting someone reuses their row
// instead of creating a second one that would race at accept time.
merchantMemberSchema.index(
  { merchant: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);

// Exactly one owner row per store, enforced by Mongo rather than by controller
// code. Deliberately not scoped to status: an ownership transfer must demote the
// outgoing owner before promoting the incoming one, so a store is never
// momentarily ownerless-but-two-owners in the index.
merchantMemberSchema.index(
  { merchant: 1, role: 1 },
  { unique: true, partialFilterExpression: { role: 'owner' } }
);

// Listing a store's team.
merchantMemberSchema.index({ merchant: 1, status: 1 });

const MerchantMember = mongoose.model('MerchantMember', merchantMemberSchema);
export default MerchantMember;
