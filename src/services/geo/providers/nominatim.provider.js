/**
 * OpenStreetMap / Nominatim adapter.
 *
 * Exists for three reasons:
 *  1. It proves the abstraction — swapping `GEO_PROVIDER=google` to
 *     `GEO_PROVIDER=nominatim` changes nothing above this file.
 *  2. It is a zero-cost local-dev and CI provider.
 *  3. It is a production fallback for markets where Google coverage or billing
 *     is a problem.
 *
 * The API shape is also spoken by LocationIQ and MapTiler's geocoder, so
 * pointing `GEO_NOMINATIM_URL` at a paid host gives production-grade rate
 * limits without touching code.
 *
 * Env:
 *   GEO_NOMINATIM_URL       base URL (default: public OSM instance)
 *   GEO_NOMINATIM_KEY       optional api key for compatible commercial hosts
 *   GEO_NOMINATIM_EMAIL     contact email — required by the public OSM usage policy
 *   GEO_TILE_URL            raster tile template handed to clients
 *   GEO_TILE_ATTRIBUTION    attribution string clients must display
 */
import axios from 'axios';
import { GeoProvider, GeoProviderError } from '../GeoProvider.js';
import { GEO_ACCURACY, makeGeoAddress, makeGeoSuggestion } from '../types.js';

const DEFAULT_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * The public OSM instance allows 1 request/second. We serialise outbound calls
 * through a promise chain with a minimum gap so a burst of users can never get
 * the whole platform blocked. Commercial hosts set `minIntervalMs: 0`.
 */
class RequestPacer {
  constructor(minIntervalMs) {
    this.minIntervalMs = minIntervalMs;
    this.tail = Promise.resolve();
    this.lastAt = 0;
  }

  run(fn) {
    const scheduled = this.tail.then(async () => {
      if (this.minIntervalMs > 0) {
        const wait = this.minIntervalMs - (Date.now() - this.lastAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      this.lastAt = Date.now();
      return fn();
    });

    // Keep the chain alive even when a call rejects, otherwise one failure
    // permanently wedges the pacer.
    this.tail = scheduled.then(
      () => undefined,
      () => undefined,
    );

    return scheduled;
  }
}

/** OSM `class`/`type` → neutral accuracy. */
const accuracyFor = (item) => {
  if (item.osm_type === 'node' && item.class === 'place') return GEO_ACCURACY.EXACT;
  if (item.class === 'building' || item.type === 'house') return GEO_ACCURACY.EXACT;
  if (item.class === 'highway') return GEO_ACCURACY.INTERPOLATED;
  return GEO_ACCURACY.APPROXIMATE;
};

export class NominatimGeoProvider extends GeoProvider {
  static get key() {
    return 'nominatim';
  }

  constructor(config = {}) {
    super(config);
    this.baseUrl = (config.baseUrl || DEFAULT_URL).replace(/\/+$/, '');
    this.apiKey = config.apiKey || '';
    this.email = config.email || '';
    this.tileUrl = config.tileUrl || DEFAULT_TILE_URL;
    this.attribution = config.attribution || DEFAULT_ATTRIBUTION;

    const isPublicOsm = this.baseUrl === DEFAULT_URL;
    this.pacer = new RequestPacer(config.minIntervalMs ?? (isPublicOsm ? 1100 : 0));

    this.http = axios.create({
      timeout: config.timeoutMs ?? 6000,
      headers: {
        // Nominatim rejects requests without a descriptive User-Agent.
        'User-Agent': config.userAgent || 'NubianPlatform/1.0 (+https://nubian-sd.com)',
        'Accept-Language': 'en',
      },
    });
  }

  get capabilities() {
    return {
      reverseGeocode: true,
      forwardGeocode: true,
      autocomplete: true,
      placeDetails: true,
      // OSM has no first-party static image API.
      staticMap: false,
    };
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  getClientConfig() {
    return {
      ...super.getClientConfig(),
      styleUrl: this.config.styleUrl || null,
      tileUrl: this.tileUrl,
      attribution: this.attribution,
      maxZoom: 19,
    };
  }

  #params(extra) {
    const params = { format: 'jsonv2', addressdetails: 1, ...extra };
    if (this.apiKey) params.key = this.apiKey;
    if (this.email) params.email = this.email;
    return params;
  }

  async #call(path, params, operation) {
    try {
      const res = await this.pacer.run(() =>
        this.http.get(`${this.baseUrl}${path}`, { params: this.#params(params) }),
      );
      return res.data;
    } catch (err) {
      throw new GeoProviderError(`Nominatim ${operation} request failed`, {
        provider: this.key,
        cause: err,
      });
    }
  }

  #toAddress(item) {
    const a = item.address || {};

    return makeGeoAddress({
      lat: item.lat,
      lng: item.lon,
      formattedAddress: item.display_name || '',
      countryCode: a.country_code || '',
      country: a.country || '',
      administrativeArea: a.state || a.region || '',
      subAdministrativeArea: a.county || a.state_district || '',
      city: a.city || a.town || a.village || a.municipality || '',
      neighborhood: a.suburb || a.neighbourhood || a.city_district || a.quarter || '',
      street: a.road || '',
      streetNumber: a.house_number || '',
      postalCode: a.postcode || '',
      // `osm_type/osm_id` is the stable OSM identity; it round-trips through
      // `placeDetails` via the /lookup endpoint.
      placeId: item.osm_type && item.osm_id ? `${item.osm_type}/${item.osm_id}` : '',
      provider: this.key,
      accuracy: accuracyFor(item),
    });
  }

  async reverseGeocode({ lat, lng, language = 'en' }) {
    const data = await this.#call(
      '/reverse',
      { lat, lon: lng, 'accept-language': language, zoom: 18 },
      'reverse geocode',
    );
    if (!data || data.error) return null;
    return this.#toAddress(data);
  }

  async forwardGeocode({ query, language = 'en', countryCodes = [] }) {
    const params = { q: query, 'accept-language': language, limit: 1 };
    if (countryCodes.length) params.countrycodes = countryCodes.join(',');

    const data = await this.#call('/search', params, 'forward geocode');
    const item = Array.isArray(data) ? data[0] : null;
    return item ? this.#toAddress(item) : null;
  }

  async autocomplete({ query, language = 'en', lat, lng, radiusMeters, countryCodes = [] }) {
    const params = { q: query, 'accept-language': language, limit: 8 };
    if (countryCodes.length) params.countrycodes = countryCodes.join(',');

    // Nominatim has no proximity bias, only a viewbox. Approximate a radius as a
    // bounding box so nearby results still rank first.
    if (Number.isFinite(lat) && Number.isFinite(lng) && radiusMeters) {
      const dLat = radiusMeters / 111_320;
      const dLng = radiusMeters / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
      params.viewbox = [lng - dLng, lat + dLat, lng + dLng, lat - dLat].join(',');
      params.bounded = 0;
    }

    const data = await this.#call('/search', params, 'autocomplete');
    if (!Array.isArray(data)) return [];

    return data.map((item) => {
      const [head, ...rest] = String(item.display_name || '').split(',');
      return makeGeoSuggestion({
        id: item.osm_type && item.osm_id ? `${item.osm_type}/${item.osm_id}` : String(item.place_id),
        title: item.name || head || '',
        subtitle: rest.join(',').trim(),
        description: item.display_name,
        provider: this.key,
        lat: item.lat,
        lng: item.lon,
      });
    });
  }

  async placeDetails({ id, language = 'en' }) {
    // `osm_type/osm_id` → the single-letter prefix /lookup expects (N/W/R).
    const match = /^(node|way|relation)\/(\d+)$/.exec(id);
    if (!match) return null;

    const osmIds = `${match[1][0].toUpperCase()}${match[2]}`;
    const data = await this.#call(
      '/lookup',
      { osm_ids: osmIds, 'accept-language': language },
      'place details',
    );

    const item = Array.isArray(data) ? data[0] : null;
    return item ? this.#toAddress(item) : null;
  }
}

export default NominatimGeoProvider;
