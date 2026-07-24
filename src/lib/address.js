/**
 * Address shaping helpers shared by the address controller, the order service
 * and the migration script.
 *
 * These functions must behave correctly for **both** address generations:
 * a v1 row (manual Country → City → SubCity, no pin) and a v2 row (map pin plus
 * shopper-entered detail). Keeping the branching here — rather than at each call
 * site — is what stops the two generations from leaking into every consumer.
 */
import {
  ADDRESS_CONFIDENCE,
  ADDRESS_LABEL,
  LOCATION_SOURCE,
  deriveAddressConfidence,
  isValidCoordinate,
} from '../services/geo/types.js';

const clean = (value) => String(value ?? '').trim();

/** Join non-empty parts with a separator, collapsing blanks. */
const join = (parts, separator = ' - ') => parts.map(clean).filter(Boolean).join(separator);

/** Read lat/lng off a document or a plain object, tolerating either shape. */
export const getCoordinates = (addr) => {
  if (!addr) return null;

  // Mongoose virtual (hydrated doc) or an explicitly-carried lat/lng (snapshot).
  if (isValidCoordinate(addr.latitude, addr.longitude)) {
    return { lat: Number(addr.latitude), lng: Number(addr.longitude) };
  }

  // Raw GeoJSON — .lean() results and update payloads land here. [lng, lat].
  const coords = addr.location?.coordinates;
  if (Array.isArray(coords) && coords.length === 2 && isValidCoordinate(coords[1], coords[0])) {
    return { lat: Number(coords[1]), lng: Number(coords[0]) };
  }

  return null;
};

/** Build the GeoJSON sub-document for a lat/lng pair, or undefined if invalid. */
export const toGeoPoint = (lat, lng) =>
  isValidCoordinate(lat, lng)
    ? { type: 'Point', coordinates: [Number(lng), Number(lat)] }
    : undefined;

/**
 * The shopper-entered "how do I actually find the door" detail.
 * Deliberately separate from the geocoded line: couriers read this part.
 */
export const describeDeliveryDetails = (addr = {}) => {
  const parts = [];
  if (clean(addr.building)) parts.push(`Building ${clean(addr.building)}`);
  if (clean(addr.floor)) parts.push(`Floor ${clean(addr.floor)}`);
  if (clean(addr.apartment)) parts.push(`Apt ${clean(addr.apartment)}`);
  if (clean(addr.landmark)) parts.push(`Near ${clean(addr.landmark)}`);
  return parts.join(', ');
};

/**
 * A human-readable one-liner for an address, whichever generation it is.
 *
 * `formattedAddress` wins outright when present — it is what the provider says
 * the pin is, and it is what the shopper saw and confirmed on the map.
 *
 * Otherwise the line is composed slot by slot, each slot preferring the
 * geocoded field and falling back to its legacy equivalent. Composing per-slot
 * rather than picking a whole "v2 branch" or "v1 branch" matters because the two
 * generations share fields: a legacy row has `street` but no `city`, so a
 * geocoded-first branch would have emitted the street and silently dropped the
 * city.
 */
export const composeAddressLine = (addr = {}) => {
  const formatted = clean(addr.formattedAddress);
  if (formatted) return formatted;

  return join(
    [
      join([addr.streetNumber, addr.street], ' '),
      addr.neighborhood || addr.area || addr.subCityName,
      addr.city || addr.cityName,
      addr.administrativeArea,
      addr.country || addr.countryName,
    ],
    ', ',
  );
};

/**
 * The single-line string persisted on `Order.address`.
 *
 * Order records have always stored a flat string here and the dashboard, emails
 * and invoices all read it, so the output must stay a plain readable line. What
 * changed is that v2 addresses can contribute far better content.
 *
 * @returns {string} never longer than 500 chars (the Order.address cap)
 */
export const buildShippingAddressText = (addr = {}) => {
  const line = composeAddressLine(addr);
  const details = describeDeliveryDetails(addr);

  const text = join([
    addr.name,
    line,
    // `building` is already inside `details`; only fall back to it when there
    // are no structured details at all (pure legacy row).
    details || addr.building,
    clean(addr.notes) ? `ملاحظات: ${clean(addr.notes)}` : null,
  ]);

  return text.slice(0, 500);
};

/**
 * Freeze an address into the immutable snapshot stored on an order.
 *
 * Orders must never depend on a user's saved address after the fact: editing or
 * deleting an address cannot be allowed to change where a past order was sent.
 * Everything a courier, a support agent or a future routing engine needs is
 * copied here at checkout time.
 *
 * @param {Object} addr - Address document or lean object
 * @returns {Object} plain object matching `addressSnapshotSchema`
 */
export const toAddressSnapshot = (addr = {}) => {
  const coords = getCoordinates(addr);
  const locationSource = Object.values(LOCATION_SOURCE).includes(addr.locationSource)
    ? addr.locationSource
    : LOCATION_SOURCE.LEGACY;

  return {
    addressId: addr._id ?? null,

    name: clean(addr.name),
    phone: clean(addr.phone),
    whatsapp: clean(addr.whatsapp),

    // Pin, stored twice on purpose.
    //
    // `location` is GeoJSON [lng, lat] so orders stay queryable with $geoWithin
    // / $geoIntersects for routing and zone analytics. `latitude` / `longitude`
    // are the same numbers in human order, denormalised so that every consumer
    // — invoices, exports, courier manifests, the dashboard — reads them
    // without re-deriving them and without the [lng, lat] flip that is the
    // single easiest thing to get backwards. A snapshot is an immutable record,
    // so the duplication can never drift.
    location: coords ? { type: 'Point', coordinates: [coords.lng, coords.lat] } : undefined,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,

    formattedAddress: composeAddressLine(addr).slice(0, 500),
    placeId: clean(addr.placeId),
    plusCode: clean(addr.plusCode),
    geoProvider: clean(addr.geoProvider),
    countryCode: clean(addr.countryCode).toUpperCase(),
    country: clean(addr.country) || clean(addr.countryName),
    administrativeArea: clean(addr.administrativeArea),
    city: clean(addr.city) || clean(addr.cityName),
    neighborhood: clean(addr.neighborhood) || clean(addr.area) || clean(addr.subCityName),
    postalCode: clean(addr.postalCode),

    // Shopper-entered detail
    street: clean(addr.street),
    building: clean(addr.building),
    floor: clean(addr.floor),
    apartment: clean(addr.apartment),
    landmark: clean(addr.landmark),
    notes: clean(addr.notes),

    addressLabel: Object.values(ADDRESS_LABEL).includes(addr.addressLabel)
      ? addr.addressLabel
      : ADDRESS_LABEL.OTHER,
    locationSource,

    // Recomputed rather than copied: the snapshot must describe how reliable
    // the address was *at checkout*, and a stored value could be stale if the
    // address was edited between saves.
    addressConfidence: Object.values(ADDRESS_CONFIDENCE).includes(addr.addressConfidence)
      ? addr.addressConfidence
      : deriveAddressConfidence({ locationSource, hasCoordinates: Boolean(coords) }),

    geocodeAccuracy: clean(addr.geocodeAccuracy) || 'unknown',
    locationAccuracyMeters:
      typeof addr.locationAccuracyMeters === 'number' ? addr.locationAccuracyMeters : null,

    // Legacy hierarchy ids, carried so old reports and any in-flight tooling
    // that joins on them keep resolving.
    countryId: addr.countryId ?? null,
    cityId: addr.cityId ?? null,
    subCityId: addr.subCityId ?? null,

    snapshotAt: new Date(),
  };
};

/**
 * Apply a reverse-geocode / place-details result onto an address payload.
 * Only fills the *derived* fields — never touches what the shopper typed.
 *
 * @param {Object} target - address payload being built
 * @param {import('../services/geo/types.js').GeoAddress} geo
 */
export const applyGeoAddress = (target, geo) => {
  if (!geo) return target;

  target.formattedAddress = clean(geo.formattedAddress);
  target.placeId = clean(geo.placeId);
  // Optional across providers — '' is a valid, expected outcome.
  target.plusCode = clean(geo.plusCode);
  target.geoProvider = clean(geo.provider);
  target.countryCode = clean(geo.countryCode).toUpperCase();
  target.country = clean(geo.country);
  target.administrativeArea = clean(geo.administrativeArea);
  target.subAdministrativeArea = clean(geo.subAdministrativeArea);
  target.city = clean(geo.city);
  target.neighborhood = clean(geo.neighborhood);
  target.postalCode = clean(geo.postalCode);
  target.geocodeAccuracy = clean(geo.accuracy) || 'unknown';
  target.geocodedAt = new Date();

  // Only adopt the geocoded street when the shopper hasn't written their own —
  // "the alley behind the blue mosque" beats a provider's road name.
  if (!clean(target.street)) {
    target.street = join([geo.streetNumber, geo.street], ' ');
  }

  return target;
};
