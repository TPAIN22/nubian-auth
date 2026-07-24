import mongoose from 'mongoose';

/**
 * DeliveryZone — the geographic primitive the delivery roadmap is built on.
 *
 * Nothing consumes this yet. It exists now so that distance-based pricing,
 * driver routing, merchant service areas and coverage checks can all be built
 * later **without another address/order schema migration** — which is the whole
 * point of storing GeoJSON pins on Address and Order.
 *
 * ## How it is meant to be used
 *
 * Which zone covers a pin:
 * ```js
 * DeliveryZone.findOne({
 *   isActive: true,
 *   area: { $geoIntersects: { $geometry: address.location } },
 * }).sort({ priority: -1 });
 * ```
 *
 * Merchant service area — "can this merchant deliver to this pin":
 * ```js
 * DeliveryZone.exists({
 *   merchant: merchantId,
 *   isActive: true,
 *   area: { $geoIntersects: { $geometry: address.location } },
 * });
 * ```
 *
 * Distance-based price: take `pricing.baseFee`, add
 * `pricing.perKmFee × max(0, km − pricing.includedKm)`, clamp to
 * `pricing.maxFee`, and zero it above `pricing.freeAboveOrderValue`. Distance
 * comes from `haversineMeters` in `services/geo/types.js` today and can be
 * swapped for a routing provider's road distance later without touching this
 * schema — that is why the fee model is expressed per-km rather than per-hop.
 */

const pricingSchema = new mongoose.Schema(
  {
    /** Flat fee applied to any delivery inside the zone, in `currencyCode`. */
    baseFee: { type: Number, default: 0, min: 0 },

    /** Kilometres included in `baseFee` before per-km charging starts. */
    includedKm: { type: Number, default: 0, min: 0 },

    /** Marginal fee per kilometre beyond `includedKm`. */
    perKmFee: { type: Number, default: 0, min: 0 },

    /** Upper bound on the computed fee. null = uncapped. */
    maxFee: { type: Number, default: null, min: 0 },

    /** Order subtotal (in `currencyCode`) at or above which delivery is free. null = never. */
    freeAboveOrderValue: { type: Number, default: null, min: 0 },

    /**
     * Currency these amounts are expressed in. Defaults to USD to match the
     * platform's pricing base — the FX layer converts for display, exactly as
     * it does for product prices.
     */
    currencyCode: { type: String, trim: true, uppercase: true, maxlength: 3, default: 'USD' },
  },
  { _id: false }
);

const deliveryZoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameAr: { type: String, trim: true, default: '', maxlength: 120 },

    /**
     * Owning merchant, or null for a platform-wide zone.
     * A merchant's set of zones *is* its service area.
     */
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Merchant',
      default: null,
    },

    /**
     * Zone boundary as GeoJSON. Polygon for a simple area, MultiPolygon for a
     * city split by a river or an exclusion hole.
     *
     * Coordinates are **[longitude, latitude]** and the outer ring must be
     * closed (first point repeated last) — Mongo rejects anything else at index
     * time.
     */
    area: {
      type: {
        type: String,
        enum: ['Polygon', 'MultiPolygon'],
        required: true,
      },
      coordinates: {
        type: [],
        required: true,
      },
    },

    pricing: { type: pricingSchema, default: () => ({}) },

    /**
     * Resolution order when zones overlap — highest wins. Lets a cheap
     * city-centre zone sit inside an expensive metro-wide one.
     */
    priority: { type: Number, default: 0 },

    /** Typical fulfilment time, for showing an ETA at checkout. */
    estimatedMinMinutes: { type: Number, default: null, min: 0 },
    estimatedMaxMinutes: { type: Number, default: null, min: 0 },

    /** Soft switch — disable a zone without deleting its geometry or history. */
    isActive: { type: Boolean, default: true },

    /**
     * Legacy bridge: the manual-hierarchy ids this zone corresponds to, where
     * one exists. Lets zones be seeded from the existing City/SubCity rows and
     * lets un-pinned legacy addresses still be matched to a zone by name.
     */
    countryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', default: null },
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: 'City', default: null },
    subCityId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubCity', default: null },

    notes: { type: String, trim: true, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

// The lookup every delivery feature performs: "which active zone covers this pin".
deliveryZoneSchema.index({ area: '2dsphere' });
deliveryZoneSchema.index({ merchant: 1, isActive: 1 });
deliveryZoneSchema.index({ isActive: 1, priority: -1 });

export default mongoose.model('DeliveryZone', deliveryZoneSchema);
