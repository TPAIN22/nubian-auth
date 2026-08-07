import mongoose from 'mongoose';
import {
  COLLECTION_DESCRIPTION_MAX,
  COLLECTION_NAME_MAX,
  COLLECTION_NAME_MIN,
  COLLECTION_PRODUCTS_MAX,
  COLLECTION_SLUG_MAX,
  COLLECTION_SORT_ORDER_MAX,
  COLLECTION_SORT_ORDER_MIN,
} from '../lib/collection.js';

/**
 * A curated, ordered list of products.
 *
 * The relationship lives here rather than as a `collectionId` on Product,
 * because a product belongs to many collections and — more importantly —
 * because the *order* is the editorial content. An array on this side stores
 * that order for free; a field on Product could not express it at all.
 *
 * Only ids are stored. Denormalising product data into the collection would
 * mean every price change, rename or stock movement had to fan out into every
 * collection that mentions the product.
 */
const collectionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: COLLECTION_NAME_MIN,
      maxlength: COLLECTION_NAME_MAX,
    },

    /**
     * Stable, human-readable handle. Unique so a campaign link can address a
     * collection by name, and so two "Best Sellers" cannot coexist by accident.
     * Derived from `name` by the controller when the admin doesn't supply one.
     */
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: COLLECTION_SLUG_MAX,
      unique: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: COLLECTION_DESCRIPTION_MAX,
      default: '',
    },

    /** ImageKit URL, same pipeline as banners and categories. Optional. */
    image: { type: String, default: null },

    /**
     * ORDER IS DATA. Mongoose preserves array order on read and write, so the
     * position of an id in this array is the position of the product on the
     * collection screen. Nothing in the read path sorts it.
     *
     * Cross-field rules (no duplicates, ids must exist) are enforced by
     * `lib/collection.js` in the validator and by the controller against the
     * database — the schema only guarantees storage shape and the upper bound.
     */
    products: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
      default: [],
      validate: {
        validator: (v) => !Array.isArray(v) || v.length <= COLLECTION_PRODUCTS_MAX,
        message: `A collection may contain at most ${COLLECTION_PRODUCTS_MAX} products`,
      },
    },

    isActive: { type: Boolean, default: true, index: true },

    /** Ascending. Lower sorts first, matching the banner `order` convention. */
    sortOrder: {
      type: Number,
      default: 0,
      min: COLLECTION_SORT_ORDER_MIN,
      max: COLLECTION_SORT_ORDER_MAX,
    },
  },
  { timestamps: true },
);

// Public listing: active collections in curated order, newest first on a tie.
collectionSchema.index({ isActive: 1, sortOrder: 1, createdAt: -1 });

const Collection = mongoose.model('Collection', collectionSchema);

export default Collection;
