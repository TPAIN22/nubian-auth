import mongoose from 'mongoose';
import { calculateFinalPrice } from '../lib/pricing.engine.js';
import { DEFAULT_NUBIAN_MARKUP, NUBIAN_MARKUP_MIN, NUBIAN_MARKUP_MAX } from '../lib/pricing.config.js';

const variantSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true },
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    merchantPrice: { type: Number, required: true, min: 1 },

    // Nubian's fixed margin on top of merchant price (admin-set; the default
    // comes from NUBIAN_MARKUP — see lib/pricing.config.js)
    nubianMarkup: {
      type: Number,
      default: () => DEFAULT_NUBIAN_MARKUP,
      min: NUBIAN_MARKUP_MIN,
      max: NUBIAN_MARKUP_MAX,
    },
    // System-computed demand & scarcity adjustment (-20% to +50%)
    dynamicMarkup: { type: Number, default: 0, min: -20, max: 50 },
    // One-off absolute discount the merchant provides (₩ amount, not %)
    merchantDiscount: { type: Number, default: 0, min: 0 },

    // Computed and stored by pre-save + dynamic pricing cron
    finalPrice: { type: Number, default: 0, min: 0 },

    stock: { type: Number, required: true, min: 0 },
    images: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },

    variants: {
      type: [variantSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'Product must have at least one variant',
      },
    },

    // Minimum variant finalPrice — kept in sync by cron and pre-save
    finalPrice: { type: Number, default: 0, min: 0 },

    // Product-level discount that applies to EVERY variant.
    // Variant-level merchantDiscount stacks on top of this.
    // Activation gating (isActive + date window) lets future flash-sales/coupons reuse the same shape.
    discount: {
      type: {
        type: String,
        enum: ['percentage', 'fixed', null],
        default: null,
      },
      value:       { type: Number, default: 0, min: 0 },
      maxDiscount: { type: Number, default: null, min: 0 }, // cap for percentage discounts
      startsAt:    { type: Date, default: null },
      endsAt:      { type: Date, default: null },
      isActive:    { type: Boolean, default: false },
    },

    // NOTE: intentionally has NO `ref`. There is no `Offer` model anywhere in
    // the codebase, so `ref: 'Offer'` made any `.populate('appliedOfferId')`
    // throw MissingSchemaError at runtime. The field itself is kept (rather
    // than deleted) so that any value already written to a document survives —
    // Mongoose's strict mode would silently drop an unknown path on the next
    // save. Nothing reads or writes it today; add the ref back only together
    // with a real Offer model.
    appliedOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    status: {
      type: String,
      enum: ['active', 'draft', 'archived'],
      default: 'draft',
      index: true,
    },

    // === Visibility & Status ===
    isActive: { type: Boolean, default: true, index: true },

    // === Dynamic Pricing Toggle ===
    // When false, dynamicMarkup is frozen at 0 (admin locks the price)
    dynamicPricingEnabled: { type: Boolean, default: true },

    // === Admin Ranking Fields (top-level for easy querying/sorting) ===
    priorityScore: { type: Number, default: 0, min: 0, max: 100, index: true },
    featured: { type: Boolean, default: false, index: true },

    // === Internal ranking metrics (computed by productScoring cron) ===
    ranking: {
      visibilityScore: { type: Number, default: 0, min: 0 },
      trendingScore:   { type: Number, default: 0, min: 0 },
      conversionRate:  { type: Number, default: 0, min: 0, max: 100 },
      storeRating:     { type: Number, default: 0, min: 0, max: 5 },
    },

    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },

    images: {
      type: [String],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'At least one image is required',
      },
    },

    // reviews array removed — query Review.find({ product }) instead.
    // Keeping an embedded array of ObjectIds caused unbounded document growth
    // and had no query benefit over the indexed Review collection.
    averageRating: { type: Number, default: 0, min: 0, max: 5 },

    // Persisted sum of active-variant stocks. Kept in sync by the pre-save hook
    // and by any variant stock mutation. Using a real field (vs a virtual) ensures
    // it is accessible in lean() queries and aggregation pipelines.
    stock: { type: Number, default: 0, min: 0, index: true },

    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', default: null },

    deletedAt: { type: Date, default: null, index: true },

    // Stable identifier used by the bulk-import flow to upsert rows.
    // Sparse + unique per merchant — products created outside import don't set it.
    importSku: { type: String, trim: true, default: null },

    // === Tracking Signals (updated by cron every hour) ===
    // Used by dynamic pricing & scoring to compute adjustments
    trackingFields: {
      views24h:      { type: Number, default: 0, min: 0 },
      cartCount24h:  { type: Number, default: 0, min: 0 },
      sales24h:      { type: Number, default: 0, min: 0 },
      favoritesCount: { type: Number, default: 0, min: 0 },
      scoreCalculatedAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ===== Virtuals =====
// Total stock across ALL variants including inactive — for internal/admin use only
productSchema.virtual('totalStock').get(function () {
  if (!this.variants) return 0;
  return this.variants.reduce((total, v) => total + (v.stock || 0), 0);
});

// ===== Indexes =====
productSchema.index({ status: 1, deletedAt: 1, createdAt: -1 });
productSchema.index({ merchant: 1, deletedAt: 1 });
productSchema.index({ 'ranking.visibilityScore': -1 });
productSchema.index({ 'ranking.trendingScore': -1 });
// SKUs are unique across LIVE products only — a soft-deleted product must not
// keep its SKUs reserved forever (re-adding a deleted product then fails with
// E11000 against a document the UI can't even show).
//
// `sparse` cannot be combined with `partialFilterExpression`, so the $exists
// clause does that job: without it, every live product with no variants.sku
// would index as null and the second one would collide.
//
// Changing this spec alone does NOT replace the deployed index — Mongoose never
// drops an existing one. Run: node src/scripts/migrate_sku_index_partial.js
productSchema.index(
  { 'variants.sku': 1 },
  {
    name: 'variants_sku_live_unique',
    unique: true,
    partialFilterExpression: { deletedAt: null, 'variants.sku': { $exists: true } },
  }
);
// Bulk-import upsert key — one importSku per merchant.
productSchema.index({ merchant: 1, importSku: 1 }, { unique: true, sparse: true });
productSchema.index({ isActive: 1, deletedAt: 1, priorityScore: -1, featured: -1 });

// Home screen & category listing queries
productSchema.index({ 'variants.stock': 1, isActive: 1, deletedAt: 1 });
productSchema.index({ category: 1, isActive: 1, deletedAt: 1, createdAt: -1 });
// Full product listing filter (status + isActive + soft-delete + sort fields)
productSchema.index({ status: 1, isActive: 1, deletedAt: 1, priorityScore: -1, featured: -1 });
// Note: discountPrice and displayFinalPrice do not exist as top-level schema fields
// and were removed to avoid wasted index write overhead.

// ===== Pre-save Middleware: Smart Pricing Calculation =====
// Delegates to the pricing engine so the formula is identical wherever it runs
// (controller manual recalc, dynamicPricing cron, cart/order snapshot).
productSchema.pre('save', function (next) {
  if (!this.variants || this.variants.length === 0) return next();

  let minFinal = Infinity;

  this.variants.forEach((variant) => {
    variant.sku = variant.sku.trim().toUpperCase();
    const { finalPrice } = calculateFinalPrice({ product: this, variant });
    variant.finalPrice = finalPrice;

    if (variant.isActive && finalPrice > 0 && finalPrice < minFinal) {
      minFinal = finalPrice;
    }
  });

  // `null` is the deliberate "no purchasable (active) variant" signal.
  //
  // Reviewed and left as-is: switching it to 0 would look tidier against the
  // `min: 0` Number field, but 0 is indistinguishable from a real price and
  // MongoDB's type bracketing is what currently saves us — `{ finalPrice:
  // { $lte: X } }` does NOT match null, so an all-inactive product is excluded
  // from the explore maxPrice filter. With 0 it would match every maxPrice
  // query and sort first under `price_low`, surfacing "free" products to
  // shoppers. Both null and 0 are equally excluded by the `$gte` minPrice
  // filter, so there is nothing to gain. Callers must treat null as "no price".
  this.finalPrice = minFinal === Infinity ? null : minFinal;

  // Keep persisted stock field in sync with active variants
  this.stock = this.variants
    .filter((v) => v.isActive !== false)
    .reduce((sum, v) => sum + (v.stock || 0), 0);

  next();
});

// Automatically exclude soft-deleted products from all find queries
productSchema.pre(/^find/, function () {
  if (this.getFilter().deletedAt === undefined) {
    this.where({ deletedAt: null });
  }
});

const Product = mongoose.model('Product', productSchema);
export default Product;
