import mongoose from 'mongoose';

const variantSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true },
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    merchantPrice: { type: Number, required: true, min: 1 },

    nubianMarkup: { type: Number, default: 10, min: 0 },
    dynamicMarkup: { type: Number, default: 0, min: -20, max: 50 },
    merchantDiscount: { type: Number, default: 0, min: 0 },

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

    finalPrice: { type: Number, default: 0, min: 0 },

    appliedOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Offer',
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

    // === Admin Ranking Fields (top-level for easy querying/sorting) ===
    priorityScore: { type: Number, default: 0, min: 0, max: 100, index: true },
    featured: { type: Boolean, default: false, index: true },

    // === Internal ranking metrics (computed by system) ===
    ranking: {
      visibilityScore: { type: Number, default: 0, min: 0 },
      conversionRate: { type: Number, default: 0, min: 0, max: 100 },
      storeRating: { type: Number, default: 0, min: 0, max: 5 },
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

    reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Review' }],
    averageRating: { type: Number, default: 0, min: 0, max: 5 },

    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', default: null },

    deletedAt: { type: Date, default: null, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ===== Virtuals =====
// Total stock across ALL variants (including inactive)
productSchema.virtual('totalStock').get(function () {
  if (!this.variants) return 0;
  return this.variants.reduce((total, variant) => total + (variant.stock || 0), 0);
});

// Active stock: sum of stock from active variants only (used by aggregation + UI)
productSchema.virtual('stock').get(function () {
  if (!this.variants) return 0;
  return this.variants
    .filter((v) => v.isActive !== false)
    .reduce((total, variant) => total + (variant.stock || 0), 0);
});

// ===== Indexes =====
productSchema.index({ status: 1, deletedAt: 1, createdAt: -1 });
productSchema.index({ merchant: 1, deletedAt: 1 });
productSchema.index({ 'ranking.visibilityScore': -1 });
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });
productSchema.index({ isActive: 1, deletedAt: 1, priorityScore: -1, featured: -1 });

// ===== Pre-save Middleware: Smart Pricing Calculation =====
productSchema.pre('save', function (next) {
  if (!this.variants || this.variants.length === 0) return next();

  let minFinal = Infinity;

  this.variants.forEach((variant) => {
    const base = variant.merchantPrice || 0;
    const markupAmt = base * ((variant.nubianMarkup ?? 10) / 100);
    const dynamicAmt = base * ((variant.dynamicMarkup ?? 0) / 100);
    variant.sku = variant.sku.trim().toUpperCase();
    const merchDiscount = variant.merchantDiscount || 0;

    let final = base + (markupAmt + dynamicAmt) - merchDiscount;

    if (final < base && merchDiscount === 0) {
      final = base;
    }

    variant.finalPrice = Math.max(1, final);

    if (variant.isActive && variant.finalPrice > 0 && variant.finalPrice < minFinal) {
      minFinal = variant.finalPrice;
    }
  });

  this.finalPrice = minFinal === Infinity ? null : minFinal;
  next();
});

const Product = mongoose.model('Product', productSchema);
export default Product;
