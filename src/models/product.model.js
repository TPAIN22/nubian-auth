import mongoose from "mongoose";

const attributeDefSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    type: { type: String, enum: ["select", "text", "number"], default: "select" },
    required: { type: Boolean, default: false },
    options: { type: [String], default: [] },
  },
  { _id: true }
);

const variantSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true },

    // Always store as Map in DB, always return as plain object in JSON
    attributes: { type: Map, of: String, required: true },

    // Keep both for compatibility
    merchantPrice: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 }, // legacy mirror

    // Smart pricing fields (do NOT auto-calc here)
    nubianMarkup: { type: Number, default: 10, min: 0 },
    dynamicMarkup: { type: Number, default: 0, min: 0 },
    finalPrice: { type: Number, default: 0, min: 0 },

    // Legacy discount (optional)
    discountPrice: { type: Number, default: 0, min: 0 },

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

    // Product-level pricing for simple products
    merchantPrice: {
      type: Number,
      required: function () {
        return !this.variants || this.variants.length === 0;
      },
      min: 0,
      default: undefined,
    },
    price: {
      type: Number,
      required: function () {
        return !this.variants || this.variants.length === 0;
      },
      min: 0,
      default: undefined,
    },

    nubianMarkup: { type: Number, default: 10, min: 0 },
    dynamicMarkup: { type: Number, default: 0, min: 0 },
    finalPrice: { type: Number, default: 0, min: 0 }, // optional for variant products, but helpful for UI

    discountPrice: { type: Number, default: 0, min: 0 },

    // Stock for simple products; for variant products you can store aggregate stock
    stock: {
      type: Number,
      required: function () {
        return !this.variants || this.variants.length === 0;
      },
      min: 0,
      default: undefined,
    },

    // Legacy fields
    sizes: { type: [String], default: [] },
    colors: { type: [String], default: [] },

    // New attributes definitions (UI depends on this)
    attributes: { type: [attributeDefSchema], default: [] },

    // Variants
    variants: { type: [variantSchema], default: [] },

    isActive: { type: Boolean, default: true },

    // Admin ranking controls
    priorityScore: { type: Number, default: 0, min: 0, max: 100 },
    featured: { type: Boolean, default: false },

    // Tracking + ranking (keep only what you actually use)
    trackingFields: {
      views24h: { type: Number, default: 0, min: 0 },
      cartCount24h: { type: Number, default: 0, min: 0 },
      sales24h: { type: Number, default: 0, min: 0 },
      favoritesCount: { type: Number, default: 0, min: 0 },
    },

    rankingFields: {
      visibilityScore: { type: Number, default: 0, min: 0 },
      conversionRate: { type: Number, default: 0, min: 0, max: 100 },
      storeRating: { type: Number, default: 0, min: 0, max: 5 },
      priorityScore: { type: Number, default: 0, min: 0 },
      featured: { type: Boolean, default: false },
    },

    // Quick access index field (if you sort by it)
    visibilityScore: { type: Number, default: 0, min: 0, index: true },
    scoreCalculatedAt: { type: Date, default: null },

    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },

    images: {
      type: [String],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "At least one image is required",
      },
    },

    reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: "Review" }],
    averageRating: { type: Number, default: 0, min: 0, max: 5 },

    merchant: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", default: null },

    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

// ===== JSON Transform =====
productSchema.set("toJSON", {
  transform: function (_doc, ret) {
    if (Array.isArray(ret.variants)) {
      ret.variants = ret.variants.map((v) => {
        if (v?.attributes instanceof Map) v.attributes = Object.fromEntries(v.attributes);
        return v;
      });
    }
    if (ret?._id) ret._id = String(ret._id);
    return ret;
  },
});

// ===== Indexes (keep the important ones only) =====
productSchema.index({ category: 1, isActive: 1, deletedAt: 1 });
productSchema.index({ merchant: 1, deletedAt: 1, createdAt: -1 });
productSchema.index({ isActive: 1, deletedAt: 1, featured: -1, priorityScore: -1, createdAt: -1 });
productSchema.index({ visibilityScore: -1 });

const Product = mongoose.model("Product", productSchema);
export default Product;
