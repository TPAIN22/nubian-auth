import mongoose from 'mongoose';
import { ADDRESS_CONFIDENCE, ADDRESS_LABEL, LOCATION_SOURCE } from '../services/geo/types.js';

/**
 * Address — map-first, with the legacy hierarchy preserved.
 *
 * ## Two generations, one collection
 *
 * `schemaVersion` tells the generations apart:
 *   1 — created against the old Country → City → SubCity dropdowns. No pin.
 *   2 — created (or migrated) with the map-first flow.
 *
 * **Every legacy field below is still written and still read.** Old rows keep
 * working untouched, old orders keep resolving, and existing dashboard queries
 * keep returning the same shapes. Nothing is dropped — removing a legacy field
 * is a separate, much later decision that needs its own migration.
 *
 * ## Where the truth lives
 *
 * For a v2 address the delivery truth is `location` (the pin) plus the
 * shopper-entered details (building/floor/apartment/landmark). `formattedAddress`
 * and the administrative fields are *derived* from reverse geocoding and may be
 * empty — a pin with no label is still perfectly deliverable, and we never block
 * a save on a geocoder being reachable.
 *
 * ## Built for delivery features that don't exist yet
 *
 * `location` is GeoJSON with a 2dsphere index, so distance calculation, driver
 * routing, delivery-zone matching ($geoIntersects against DeliveryZone),
 * distance-based shipping pricing and merchant service areas can all be built on
 * top without another schema migration.
 */

const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    name: { type: String, trim: true, default: '', maxlength: 100 },

    // ───────────────────────────────────────────────────────────────────────
    // LEGACY: manual Country → City → SubCity hierarchy.
    // Retained for backward compatibility. Still populated for v1 addresses and
    // still honoured on read. Do not remove.
    // ───────────────────────────────────────────────────────────────────────
    countryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Country' },
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: 'City' },
    subCityId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubCity' },

    countryName: { type: String, trim: true, default: '', maxlength: 100 },
    cityName: { type: String, trim: true, default: '', maxlength: 100 },
    subCityName: { type: String, trim: true, default: '', maxlength: 100 },

    area: { type: String, trim: true, default: '', maxlength: 100 },

    // ───────────────────────────────────────────────────────────────────────
    // SHARED: meaningful in both generations.
    // `city` and `street` are written by the geocoder for v2 addresses and were
    // free text in v1 — same meaning either way, so they are not duplicated.
    // ───────────────────────────────────────────────────────────────────────
    city: { type: String, trim: true, default: '', maxlength: 100 },
    street: { type: String, trim: true, default: '', maxlength: 200 },
    building: { type: String, trim: true, default: '', maxlength: 100 },

    phone: { type: String, trim: true, default: '', maxlength: 30 },
    whatsapp: { type: String, trim: true, default: '', maxlength: 30 },

    notes: { type: String, trim: true, default: '', maxlength: 500 },

    isDefault: { type: Boolean, default: false },

    // ───────────────────────────────────────────────────────────────────────
    // MAP-FIRST: the pin and everything derived from it.
    // ───────────────────────────────────────────────────────────────────────

    /**
     * GeoJSON Point, **[longitude, latitude]** — GeoJSON order, not lat/lng.
     * Use the `latitude` / `longitude` virtuals to avoid getting this wrong.
     * Undefined on un-pinned legacy addresses; the 2dsphere index is sparse so
     * those rows simply aren't indexed.
     */
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        validate: {
          validator(value) {
            if (value == null) return true;
            if (!Array.isArray(value) || value.length !== 2) return false;
            const [lng, lat] = value;
            return (
              Number.isFinite(lng) &&
              Number.isFinite(lat) &&
              lng >= -180 &&
              lng <= 180 &&
              lat >= -90 &&
              lat <= 90
            );
          },
          message: 'coordinates must be [longitude, latitude] within valid ranges',
        },
      },
    },

    /** Single-line address from reverse geocoding. May be '' — see the class docs. */
    formattedAddress: { type: String, trim: true, default: '', maxlength: 500 },

    /** Provider-scoped opaque place id. Meaningless across providers, hence `geoProvider`. */
    placeId: { type: String, trim: true, default: '', maxlength: 512 },

    /**
     * Open Location Code ("plus code"), when the active provider exposes one.
     *
     * Optional by design and never required by anything: it is a bonus for
     * couriers in areas with no street addressing, not a key. Providers that
     * don't emit plus codes simply leave this ''.
     */
    plusCode: { type: String, trim: true, default: '', maxlength: 40 },

    /** Which provider produced placeId / formattedAddress ('google', 'nominatim', …). */
    geoProvider: { type: String, trim: true, default: '', maxlength: 40 },

    countryCode: { type: String, trim: true, uppercase: true, default: '', maxlength: 2 },
    country: { type: String, trim: true, default: '', maxlength: 100 },
    administrativeArea: { type: String, trim: true, default: '', maxlength: 120 },
    subAdministrativeArea: { type: String, trim: true, default: '', maxlength: 120 },
    neighborhood: { type: String, trim: true, default: '', maxlength: 120 },
    postalCode: { type: String, trim: true, default: '', maxlength: 20 },

    // Shopper-entered detail the map can never know. This is what actually gets
    // a courier to the door.
    floor: { type: String, trim: true, default: '', maxlength: 50 },
    apartment: { type: String, trim: true, default: '', maxlength: 50 },
    landmark: { type: String, trim: true, default: '', maxlength: 200 },

    addressLabel: {
      type: String,
      enum: Object.values(ADDRESS_LABEL),
      default: ADDRESS_LABEL.HOME,
    },

    /** How the pin was obtained — see LOCATION_SOURCE. Drives how much we trust it. */
    locationSource: {
      type: String,
      enum: Object.values(LOCATION_SOURCE),
      default: LOCATION_SOURCE.LEGACY,
    },

    /**
     * How much this address can be trusted to reach the right door.
     * Always derived by the server from `locationSource` + whether a pin
     * exists — never accepted from a client, never guessed.
     * See `deriveAddressConfidence` in services/geo/types.js.
     */
    addressConfidence: {
      type: String,
      enum: Object.values(ADDRESS_CONFIDENCE),
      default: ADDRESS_CONFIDENCE.LOW,
    },

    /** Reverse-geocoder confidence at capture time (about the *label*, not the pin). */
    geocodeAccuracy: {
      type: String,
      enum: ['exact', 'interpolated', 'approximate', 'unknown'],
      default: 'unknown',
    },

    /** When the derived fields were last refreshed from a provider. */
    geocodedAt: { type: Date, default: null },

    /**
     * Reported horizontal accuracy of the pin in metres.
     *
     * Only set when the platform actually reported one (a GPS fix); stays null
     * otherwise rather than being invented — a fabricated radius would be worse
     * than no radius for any future routing or zone decision.
     */
    locationAccuracyMeters: { type: Number, default: null, min: 0 },

    // ───────────────────────────────────────────────────────────────────────
    // MIGRATION BOOKKEEPING
    // ───────────────────────────────────────────────────────────────────────

    /** 1 = manual hierarchy era, 2 = map-first. */
    schemaVersion: { type: Number, default: 2, min: 1 },

    /**
     * True when this address originated in the manual hierarchy and has never
     * been re-pinned on a map. Surfaced in the UI as a nudge to confirm the
     * location, and lets ops report on migration progress.
     */
    isLegacy: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* ── Virtuals ─────────────────────────────────────────────────────────────── */

/**
 * lat/lng in human order. Prefer these over touching `location.coordinates`,
 * which is [lng, lat] and is the single easiest thing to get backwards.
 */
addressSchema.virtual('latitude').get(function getLatitude() {
  const coords = this.location?.coordinates;
  return Array.isArray(coords) && coords.length === 2 ? coords[1] : null;
});

addressSchema.virtual('longitude').get(function getLongitude() {
  const coords = this.location?.coordinates;
  return Array.isArray(coords) && coords.length === 2 ? coords[0] : null;
});

/** True when this address can be used for distance, routing or zone matching. */
addressSchema.virtual('hasCoordinates').get(function hasCoordinates() {
  const coords = this.location?.coordinates;
  return Array.isArray(coords) && coords.length === 2;
});

/* ── Indexes ──────────────────────────────────────────────────────────────── */

addressSchema.index({ user: 1, isDefault: -1, updatedAt: -1 });

// One default address per user. Unchanged from the legacy schema.
addressSchema.index(
  { user: 1, isDefault: 1 },
  {
    unique: true,
    partialFilterExpression: { isDefault: true },
  }
);

/**
 * Geospatial index for the delivery features this schema is built to support.
 * Sparse so the (many) legacy rows with no pin are simply absent from it rather
 * than rejected.
 */
addressSchema.index({ location: '2dsphere' }, { sparse: true });

// Admin dashboard: filter by migration state and region without a collection scan.
addressSchema.index({ isLegacy: 1, updatedAt: -1 });
addressSchema.index({ countryCode: 1, city: 1 });
// "Which addresses should we prompt the shopper to confirm on a map?"
addressSchema.index({ addressConfidence: 1, updatedAt: -1 });

/* ── Hooks ────────────────────────────────────────────────────────────────── */

/**
 * Mongoose materialises `location` as `{ type: 'Point' }` (from the sub-field
 * default) as soon as anything touches it, even when no coordinates were ever
 * set. A Point with no `coordinates` is invalid GeoJSON and Mongo rejects it at
 * index time, so strip the husk before it reaches the driver.
 */
addressSchema.pre('validate', function stripEmptyLocation(next) {
  const coords = this.location?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) {
    this.location = undefined;
  }
  next();
});

addressSchema.pre('findOneAndUpdate', function normalizeLocationUpdate(next) {
  const update = this.getUpdate() || {};
  const set = update.$set || update;

  if (Object.prototype.hasOwnProperty.call(set, 'location')) {
    const coords = set.location?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) {
      // An explicit null means "clear the pin"; anything else is just noise
      // from a partial update and must not blow away an existing pin.
      const shouldClear = set.location === null;
      delete set.location;
      if (shouldClear) {
        update.$unset = { ...(update.$unset || {}), location: '' };
      }
      this.setUpdate(update);
    }
  }

  next();
});

export default mongoose.model('Address', addressSchema);
