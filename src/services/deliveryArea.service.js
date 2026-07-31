/**
 * Delivery coverage — "do we deliver to this pin?"
 *
 * The single place that answers that question. Every gate (address save,
 * checkout, and the polygon shipped to the app for pre-emptive UI) resolves
 * through here so coverage can never mean two different things in two places.
 *
 * Coverage is defined by `DeliveryZone` polygons, never by city/region *names*.
 * The reverse geocoder returns "Khartoum", "Khartoum State", "الخرطوم", "Bahri"
 * or — by explicit design in the address flow — nothing at all, so a name test
 * would reject real, deliverable addresses whenever the label is empty or in the
 * wrong language. The pin is the only field the server derives itself and never
 * takes from a client, which makes it the only safe thing to gate on.
 *
 * ## Fail-open, on purpose
 *
 * No active zones means **unrestricted**, not "reject everything". An unseeded
 * collection or a dropped database must never turn into a store that silently
 * refuses every order in the country. The same reasoning applies to a query
 * error: coverage is a commercial rule, not a security boundary, so when it
 * can't be evaluated the order goes through and the failure is logged loudly.
 * The one thing that would be unrecoverable is turning an infrastructure blip
 * into 100% checkout failure.
 */
import DeliveryZone from '../models/deliveryZone.model.js';
import { isValidCoordinate } from './geo/types.js';
import logger from '../lib/logger.js';

/** Shape returned to callers that need to explain *why* a pin was rejected. */
export const COVERAGE = Object.freeze({
  /** A zone covers the pin, or coverage is not configured at all. */
  COVERED: 'covered',
  /** Zones exist, and none of them contain this pin. */
  OUTSIDE: 'outside',
  /** The address has no pin, so coverage cannot be evaluated. */
  NO_PIN: 'no_pin',
});

/**
 * Cached client payload (the polygons the app draws its own gate from).
 *
 * Only the *serialised config* is cached, not coverage decisions: the
 * `$geoIntersects` lookup rides the 2dsphere index and is far cheaper than the
 * bookkeeping a correct decision cache would need. `/api/geo/config` is hit on
 * every app boot, though, and that payload is ~7 KB of coordinates.
 */
const CONFIG_TTL_MS = 5 * 60 * 1000;
let configCache = { value: null, expiresAt: 0 };

/** Drop the memoised client config. Call after any admin zone write. */
export const invalidateServiceAreaCache = () => {
  configCache = { value: null, expiresAt: 0 };
};

/**
 * Extract a { lat, lng } from anything that carries a pin — an Address document
 * (virtuals), a lean row or an order's address snapshot (raw GeoJSON).
 *
 * @returns {{lat:number, lng:number}|null}
 */
export const pointFrom = (source) => {
  if (!source) return null;

  if (isValidCoordinate(source.latitude, source.longitude)) {
    return { lat: Number(source.latitude), lng: Number(source.longitude) };
  }

  const coords = source.location?.coordinates;
  if (Array.isArray(coords) && coords.length === 2 && isValidCoordinate(coords[1], coords[0])) {
    return { lat: Number(coords[1]), lng: Number(coords[0]) };
  }

  return null;
};

/** True when any active zone is configured. Cheap existence check. */
const hasActiveZones = () => DeliveryZone.exists({ isActive: true });

/**
 * The active zone covering a point, or null.
 *
 * Highest `priority` wins so a cheap city-centre zone can sit inside a wider
 * metro one — the same resolution order the pricing work will need later.
 *
 * @param {{lat:number, lng:number}} point
 * @returns {Promise<Object|null>} lean DeliveryZone
 */
export const findZoneForPoint = async (point) => {
  if (!point || !isValidCoordinate(point.lat, point.lng)) return null;

  return DeliveryZone.findOne({
    isActive: true,
    area: {
      $geoIntersects: {
        $geometry: { type: 'Point', coordinates: [Number(point.lng), Number(point.lat)] },
      },
    },
  })
    .sort({ priority: -1 })
    .select('_id name nameAr pricing estimatedMinMinutes estimatedMaxMinutes')
    .lean();
};

/**
 * Evaluate coverage for an address-like object.
 *
 * @param {Object} source - Address doc, lean row or address snapshot
 * @param {{ requirePin?: boolean, requestId?: string }} [options]
 *        `requirePin` — when true, a pinless address resolves to NO_PIN instead
 *        of being waved through. Checkout sets it; the address-save gate does
 *        not, because a save with no coordinates isn't a map-flow save at all.
 * @returns {Promise<{ status: string, zone: Object|null, restricted: boolean }>}
 *          `restricted` reports whether coverage was actually enforced, so
 *          callers can tell "covered" from "nothing configured".
 */
export const evaluateCoverage = async (source, { requirePin = false, requestId } = {}) => {
  try {
    const point = pointFrom(source);

    // Zone lookup first, and only ask whether coverage is configured at all when
    // it misses. The overwhelmingly common case — a shopper inside the area we
    // serve — then costs one indexed query instead of two, and this runs on
    // every address save and every checkout.
    if (point) {
      const zone = await findZoneForPoint(point);
      if (zone) return { status: COVERAGE.COVERED, zone, restricted: true };
    }

    if (!(await hasActiveZones())) {
      return { status: COVERAGE.COVERED, zone: null, restricted: false };
    }

    if (!point) {
      return {
        status: requirePin ? COVERAGE.NO_PIN : COVERAGE.COVERED,
        zone: null,
        restricted: true,
      };
    }

    return { status: COVERAGE.OUTSIDE, zone: null, restricted: true };
  } catch (error) {
    // See the fail-open note at the top of this file.
    logger.error('deliveryArea: coverage check failed, allowing through', {
      requestId,
      error: error.message,
    });
    return { status: COVERAGE.COVERED, zone: null, restricted: false };
  }
};

/** Convenience wrapper for callers that only need a yes/no. */
export const isServiceable = async (source, options) =>
  (await evaluateCoverage(source, options)).status === COVERAGE.COVERED;

/**
 * Public service-area description for clients.
 *
 * The app uses this to grey out its own confirm button before the user types a
 * single character of address detail — the same reason `defaultCenter` and the
 * debounce timings are served rather than bundled: the boundary can be redrawn
 * without an app release.
 *
 * Zone names ship in both languages: the client renders the message in the
 * shopper's language, and "we deliver in Khartoum State" inside otherwise-Arabic
 * copy reads like a bug.
 *
 * @returns {Promise<{enabled:boolean, names:string[], namesAr:string[],
 *                    geometry:Object|null, bbox:{minLat,minLng,maxLat,maxLng}|null}>}
 */
export const getServiceAreaConfig = async () => {
  const now = Date.now();
  if (configCache.value && configCache.expiresAt > now) return configCache.value;

  let value = { enabled: false, names: [], namesAr: [], geometry: null, bbox: null };

  try {
    const zones = await DeliveryZone.find({ isActive: true })
      .select('name nameAr area')
      .lean();

    if (zones.length) {
      // Flattened into a single MultiPolygon: the client only ever asks "is this
      // point inside the area we serve", so per-zone identity is noise on the
      // wire, and one shape keeps the app's point-in-polygon test trivial.
      const polygons = [];
      for (const zone of zones) {
        const { type, coordinates } = zone.area ?? {};
        if (!Array.isArray(coordinates)) continue;
        if (type === 'Polygon') polygons.push(coordinates);
        else if (type === 'MultiPolygon') polygons.push(...coordinates);
      }

      if (polygons.length) {
        value = {
          enabled: true,
          names: zones.map((z) => z.name).filter(Boolean),
          // Falls back to the English name so a zone seeded without `nameAr`
          // still names somewhere, rather than showing an empty list.
          namesAr: zones.map((z) => z.nameAr || z.name).filter(Boolean),
          geometry: { type: 'MultiPolygon', coordinates: polygons },
          bbox: bboxOf(polygons),
        };
      }
    }
  } catch (error) {
    // A client that can't fetch the boundary simply doesn't pre-empt; the server
    // gates are what actually enforce coverage.
    logger.error('deliveryArea: failed to build service area config', {
      error: error.message,
    });
    return value;
  }

  configCache = { value, expiresAt: now + CONFIG_TTL_MS };
  return value;
};

/** Bounding box over MultiPolygon coordinates, for map camera limits and search bias. */
const bboxOf = (polygons) => {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  for (const polygon of polygons) {
    // Outer ring only — a hole can never extend the envelope.
    for (const [lng, lat] of polygon[0] ?? []) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  return Number.isFinite(minLat) ? { minLat, minLng, maxLat, maxLng } : null;
};

export default {
  COVERAGE,
  evaluateCoverage,
  findZoneForPoint,
  getServiceAreaConfig,
  invalidateServiceAreaCache,
  isServiceable,
  pointFrom,
};
