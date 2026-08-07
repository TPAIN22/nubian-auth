import mongoose from 'mongoose';
import { BANNER_TARGET_TYPES, BANNER_TARGET_URL_MAX } from '../lib/bannerTarget.js';

/**
 * Where a banner sends the user when it is tapped.
 *
 * Declared as its own Schema instance rather than inline: an inline
 * `target: { type: { type: String, ... } }` is ambiguous to Mongoose, which
 * reads the inner `type` key as the SchemaType declaration for `target` itself.
 *
 * Cross-field rules ("store needs an id", "url must not carry an id") are NOT
 * enforced here — they live in `lib/bannerTarget.js` and run in the validator
 * middleware, so the API rejects a bad combination with a field-level message
 * instead of a Mongoose cast error. The schema only guarantees storage shape.
 */
const bannerTargetSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: BANNER_TARGET_TYPES,
      default: 'none',
    },
    /**
     * Polymorphic reference — a Merchant (store), Product, Category or, once it
     * exists, a Collection. Left unref'd because `refPath` would need a second
     * stored field naming the model, and nothing populates a banner target: the
     * clients navigate by id.
     */
    id: {
      type: mongoose.Schema.Types.ObjectId,
      default: undefined,
    },
    url: {
      type: String,
      maxlength: BANNER_TARGET_URL_MAX,
      default: undefined,
    },
  },
  { _id: false },
);

const bannerSchema = new mongoose.Schema({
  image: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: false,
  },
  description: {
    type: String,
    required: false,
  },
  /**
   * Optional by design. Banners created before targets existed have no `target`
   * at all, and a missing target is read as `{ type: 'none' }` by every client —
   * so no backfill is required and existing rows keep behaving as static images.
   */
  target: {
    type: bannerTargetSchema,
    default: undefined,
  },
  order: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Banner = mongoose.model('Banner', bannerSchema);
export default Banner;
