/**
 * Vendor-neutral geo DTOs.
 *
 * Nothing in this file may reference a specific map/geocoding vendor. Providers
 * under `providers/` translate their own payloads into these shapes, and the
 * rest of the platform (controllers, models, mobile, dashboard) only ever sees
 * these. Swapping vendors must not change a single consumer.
 */

/**
 * @typedef {Object} GeoPoint
 * @property {number} lat  - Latitude, -90..90
 * @property {number} lng  - Longitude, -180..180
 */

/**
 * @typedef {Object} GeoAddress
 * @property {number}  lat
 * @property {number}  lng
 * @property {string}  formattedAddress    - Single-line human readable address
 * @property {string}  countryCode         - ISO 3166-1 alpha-2, uppercase ('SD', 'SA')
 * @property {string}  country             - Country display name
 * @property {string}  administrativeArea  - State / province / region (admin level 1)
 * @property {string}  subAdministrativeArea - District / governorate (admin level 2)
 * @property {string}  city                - Locality / city
 * @property {string}  neighborhood        - Sublocality / district / neighbourhood
 * @property {string}  street              - Route / street name
 * @property {string}  streetNumber        - House or street number
 * @property {string}  postalCode          - Postal code, '' when the region has none
 * @property {string}  placeId             - Provider-scoped opaque id ('' if unsupported)
 * @property {string}  plusCode            - Open Location Code, '' when unsupported
 * @property {string}  provider            - Provider key that produced this record
 * @property {'exact'|'interpolated'|'approximate'|'unknown'} accuracy
 */

/**
 * @typedef {Object} GeoSuggestion
 * @property {string} id            - Opaque id to pass back to `placeDetails`
 * @property {string} title         - Primary line ("Afra Mall")
 * @property {string} subtitle      - Secondary line ("Khartoum, Sudan")
 * @property {string} description   - Full single-line description
 * @property {string} provider
 * @property {number|null} lat      - Present only when the provider returns coords inline
 * @property {number|null} lng
 * @property {number|null} distanceMeters - Distance from the bias point, when known
 */

/** Ordered list of admin levels, coarsest first. Used for legacy field mapping. */
export const ADMIN_LEVELS = Object.freeze([
  'country',
  'administrativeArea',
  'subAdministrativeArea',
  'city',
  'neighborhood',
  'street',
]);

export const GEO_ACCURACY = Object.freeze({
  EXACT: 'exact',
  INTERPOLATED: 'interpolated',
  APPROXIMATE: 'approximate',
  UNKNOWN: 'unknown',
});

/**
 * Where a stored coordinate originally came from. Persisted on Address so we can
 * later reason about how much to trust a pin (e.g. for routing or zone pricing).
 */
export const LOCATION_SOURCE = Object.freeze({
  GPS: 'gps',              // device GPS fix
  MAP_PIN: 'map_pin',      // user dragged the map and confirmed
  SEARCH: 'search',        // picked from autocomplete
  GEOCODED: 'geocoded',    // derived by forward-geocoding text, not user-confirmed
  MIGRATED: 'migrated',    // pin derived during the map migration, not user-confirmed
  LEGACY: 'legacy',        // from the old city/subcity hierarchy, no pin at all
  MANUAL: 'manual',        // typed by a human (admin tooling)
});

/**
 * How much this address can be trusted to get a courier to the right door.
 *
 * Deliberately coarse: it drives product decisions (whether to prompt the
 * shopper to confirm their pin, whether a distance-based fee is safe to quote),
 * not analytics. Always derived — never accepted from a client, never guessed.
 */
export const ADDRESS_CONFIDENCE = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});

/**
 * Derive address confidence from facts we actually recorded.
 *
 * The rule is about *who* placed the point, not how pretty the label is:
 *   high   — a human looked at a map and confirmed this point
 *   medium — a machine derived the point from text; plausible but unverified
 *   low    — there is no point at all, only a text address
 *
 * A `map_pin` with a vague `formattedAddress` is still `high`: the shopper
 * confirmed the location, and the label is cosmetic. Conversely a `geocoded`
 * result with an exact-looking label is still `medium`, because nobody checked
 * that the text matched reality.
 *
 * @param {{ locationSource?: string, hasCoordinates?: boolean }} input
 * @returns {'high'|'medium'|'low'}
 */
export const deriveAddressConfidence = ({ locationSource, hasCoordinates } = {}) => {
  // No pin means no amount of metadata makes this precise.
  if (!hasCoordinates) return ADDRESS_CONFIDENCE.LOW;

  switch (locationSource) {
    case LOCATION_SOURCE.GPS:
    case LOCATION_SOURCE.MAP_PIN:
    case LOCATION_SOURCE.SEARCH:
      return ADDRESS_CONFIDENCE.HIGH;

    case LOCATION_SOURCE.GEOCODED:
    case LOCATION_SOURCE.MIGRATED:
    case LOCATION_SOURCE.MANUAL:
      return ADDRESS_CONFIDENCE.MEDIUM;

    default:
      // Coordinates from an unrecorded origin — real, but unattributed.
      return ADDRESS_CONFIDENCE.MEDIUM;
  }
};

export const ADDRESS_LABEL = Object.freeze({
  HOME: 'home',
  WORK: 'work',
  OTHER: 'other',
});

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/**
 * Build a fully-populated GeoAddress from a partial one. Providers always emit
 * through this so consumers can rely on every key existing (never `undefined`),
 * which keeps client-side optional chaining noise down.
 *
 * @param {Partial<GeoAddress>} partial
 * @returns {GeoAddress}
 */
export const makeGeoAddress = (partial = {}) => ({
  lat: Number(partial.lat),
  lng: Number(partial.lng),
  formattedAddress: str(partial.formattedAddress),
  countryCode: str(partial.countryCode).toUpperCase().slice(0, 2),
  country: str(partial.country),
  administrativeArea: str(partial.administrativeArea),
  subAdministrativeArea: str(partial.subAdministrativeArea),
  city: str(partial.city),
  neighborhood: str(partial.neighborhood),
  street: str(partial.street),
  streetNumber: str(partial.streetNumber),
  postalCode: str(partial.postalCode),
  placeId: str(partial.placeId),
  // Open Location Code. Optional by design — providers that don't expose one
  // leave it '', and nothing downstream may require it.
  plusCode: str(partial.plusCode),
  provider: str(partial.provider),
  accuracy: Object.values(GEO_ACCURACY).includes(partial.accuracy)
    ? partial.accuracy
    : GEO_ACCURACY.UNKNOWN,
});

/**
 * @param {Partial<GeoSuggestion>} partial
 * @returns {GeoSuggestion}
 */
export const makeGeoSuggestion = (partial = {}) => ({
  id: str(partial.id),
  title: str(partial.title),
  subtitle: str(partial.subtitle),
  description: str(partial.description) || str(partial.title),
  provider: str(partial.provider),
  lat: Number.isFinite(Number(partial.lat)) ? Number(partial.lat) : null,
  lng: Number.isFinite(Number(partial.lng)) ? Number(partial.lng) : null,
  distanceMeters: Number.isFinite(Number(partial.distanceMeters))
    ? Number(partial.distanceMeters)
    : null,
});

/** @returns {boolean} true when lat/lng are real, in-range numbers. */
export const isValidCoordinate = (lat, lng) => {
  const la = Number(lat);
  const ln = Number(lng);
  return (
    Number.isFinite(la) &&
    Number.isFinite(ln) &&
    la >= -90 &&
    la <= 90 &&
    ln >= -180 &&
    ln <= 180 &&
    // Reject the null island — almost always a bug, never a real delivery address.
    !(la === 0 && ln === 0)
  );
};

/**
 * Great-circle distance in metres. Kept here (not in a provider) because
 * distance must never depend on which vendor is configured.
 */
export const haversineMeters = (a, b) => {
  const R = 6371008.8; // IUGG mean Earth radius
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};
