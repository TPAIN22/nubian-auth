import mongoose from 'mongoose';

// Behaviour-tracking arrays (viewedProducts, clickedProducts, etc.) were removed.
// They caused unbounded document growth (16 MB limit risk at scale).
// All behavioural signals are now captured in the UserActivity collection with a TTL.
// Services that previously read from User.viewedProducts should be migrated to UserActivity.
const userSchema = new mongoose.Schema({
  clerkId: { type: String, required: true, unique: true },
  fullName: { type: String },
  phone:    { type: String },
  emailAddress: { type: String },

  role: {
    type: String,
    enum: ['user', 'admin', 'support', 'marketer'],
    default: 'user',
  },

  // ===== AFFILIATE =====
  referralCode: {
    type: String,
    uppercase: true,
    trim: true,
  },
  referredBy: {
    type: String,
    default: null,
    trim: true,
    uppercase: true,
  },

  // ===== CURRENCY PREFERENCES =====
  countryCode: { type: String, trim: true, uppercase: true, maxlength: 3, default: null },
  currencyCode: { type: String, trim: true, uppercase: true, maxlength: 3, default: null },

  // ===== MERCHANT DASHBOARD ONBOARDING =====
  // Progress through the guided product tour in the merchant console.
  //
  // Keyed to the PERSON, not the store. A store can be run by a team, and the
  // tour teaches somebody how to use the dashboard — an owner finishing it must
  // not silently mark it done for a member of staff invited afterwards. Keeping
  // it here is also what makes it survive a device change: it travels with the
  // Clerk account rather than with a browser.
  merchantOnboarding: {
    status: {
      type: String,
      enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'],
      default: 'NOT_STARTED',
    },
    /** Step id the tour should resume at. Null once it reaches a terminal state. */
    currentStep: { type: String, default: null, maxlength: 64 },
    /** Step ids the merchant has actually finished, in no particular order. */
    completedSteps: { type: [String], default: [] },
    /**
     * Bumped when the tour's step list changes materially enough that a stored
     * `currentStep` is no longer meaningful. The client decides what to do with
     * a mismatch; the server only stores it.
     */
    version: { type: Number, default: 1 },
    updatedAt: { type: Date, default: null },
  },

  // ===== SOFT DELETE =====
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

// Automatically exclude soft-deleted users from all find queries
// unless the caller explicitly includes isDeleted in the filter.
userSchema.pre(/^find/, function () {
  if (this.getFilter().isDeleted === undefined) {
    this.where({ isDeleted: { $ne: true } });
  }
});

userSchema.index({ emailAddress: 1 }, {
  partialFilterExpression: { isDeleted: false, emailAddress: { $type: 'string' } },
});
userSchema.index(
  { referralCode: 1 },
  {
    unique: true,
    partialFilterExpression: { referralCode: { $type: 'string' } },
  }
);
userSchema.index({ isDeleted: 1, createdAt: -1 });
userSchema.index({ referredBy: 1 });

const User = mongoose.model('User', userSchema);
export default User;
