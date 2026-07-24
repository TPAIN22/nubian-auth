/**
 * Google Maps Platform adapter.
 *
 * This is the ONLY file in the backend allowed to know Google's payload shapes.
 * Everything it returns is a neutral DTO from `../types.js`.
 *
 * Env:
 *   GEO_GOOGLE_API_KEY        server-side key (never exposed to clients)
 *   GEO_GOOGLE_STATIC_API_KEY optional separate key for Static Maps
 */
import axios from 'axios';
import { GeoProvider, GeoProviderError } from '../GeoProvider.js';
import { GEO_ACCURACY, makeGeoAddress, makeGeoSuggestion } from '../types.js';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';
const STATIC_URL = 'https://maps.googleapis.com/maps/api/staticmap';

/** Google location_type → neutral accuracy. */
const ACCURACY_MAP = {
  ROOFTOP: GEO_ACCURACY.EXACT,
  RANGE_INTERPOLATED: GEO_ACCURACY.INTERPOLATED,
  GEOMETRIC_CENTER: GEO_ACCURACY.APPROXIMATE,
  APPROXIMATE: GEO_ACCURACY.APPROXIMATE,
};

/** Pull the first address_component matching any of `types`. */
const pick = (components, types, useShortName = false) => {
  for (const type of types) {
    const hit = components.find((c) => Array.isArray(c.types) && c.types.includes(type));
    if (hit) return (useShortName ? hit.short_name : hit.long_name) || '';
  }
  return '';
};

/** Statuses that mean "no result", not "provider broken". */
const EMPTY_STATUSES = new Set(['ZERO_RESULTS', 'NOT_FOUND']);

export class GoogleGeoProvider extends GeoProvider {
  static get key() {
    return 'google';
  }

  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || '';
    this.staticApiKey = config.staticApiKey || config.apiKey || '';
    this.timeout = config.timeoutMs ?? 6000;
    this.http = axios.create({ timeout: this.timeout });
  }

  get capabilities() {
    return {
      reverseGeocode: true,
      forwardGeocode: true,
      autocomplete: true,
      placeDetails: true,
      staticMap: Boolean(this.staticApiKey),
    };
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  getClientConfig() {
    return {
      ...super.getClientConfig(),
      // Clients render Google tiles through their own platform SDK (Play
      // Services / MapKit), so there is no URL to hand out here.
      styleUrl: null,
      tileUrl: null,
      attribution: '© Google',
      maxZoom: 21,
    };
  }

  async #call(url, params, operation) {
    let res;
    try {
      res = await this.http.get(url, { params: { ...params, key: this.apiKey } });
    } catch (err) {
      throw new GeoProviderError(`Google ${operation} request failed`, {
        provider: this.key,
        cause: err,
      });
    }

    const status = res.data?.status;
    if (EMPTY_STATUSES.has(status)) return null;

    if (status !== 'OK') {
      // OVER_QUERY_LIMIT / REQUEST_DENIED / INVALID_REQUEST are all provider-side
      // problems from the caller's point of view — surface as 502 so the facade
      // can fall through to the next provider.
      throw new GeoProviderError(
        `Google ${operation} returned ${status || 'an unknown status'}`,
        { provider: this.key, cause: res.data?.error_message },
      );
    }

    return res.data;
  }

  /** Google geocode/place result → neutral GeoAddress. */
  #toAddress(result) {
    const components = result.address_components || [];
    const loc = result.geometry?.location || {};

    return makeGeoAddress({
      lat: loc.lat,
      lng: loc.lng,
      formattedAddress: result.formatted_address || result.name || '',
      countryCode: pick(components, ['country'], true),
      country: pick(components, ['country']),
      administrativeArea: pick(components, ['administrative_area_level_1']),
      subAdministrativeArea: pick(components, ['administrative_area_level_2']),
      city: pick(components, ['locality', 'postal_town', 'administrative_area_level_2']),
      neighborhood: pick(components, [
        'sublocality_level_1',
        'sublocality',
        'neighborhood',
      ]),
      street: pick(components, ['route']),
      streetNumber: pick(components, ['street_number']),
      postalCode: pick(components, ['postal_code']),
      placeId: result.place_id || '',
      // Open Location Code. `global_code` is the full worldwide code;
      // `compound_code` is the short form that only resolves with its locality
      // ("6RJ4+MC Khartoum"), so the global code is the one worth storing.
      // Google omits plus codes entirely for some results — '' is expected, and
      // no consumer may require this field.
      plusCode: result.plus_code?.global_code || '',
      provider: this.key,
      accuracy: ACCURACY_MAP[result.geometry?.location_type] || GEO_ACCURACY.UNKNOWN,
    });
  }

  async reverseGeocode({ lat, lng, language = 'en' }) {
    const data = await this.#call(
      GEOCODE_URL,
      { latlng: `${lat},${lng}`, language },
      'reverse geocode',
    );
    const result = data?.results?.[0];
    return result ? this.#toAddress(result) : null;
  }

  async forwardGeocode({ query, language = 'en', countryCodes = [] }) {
    const params = { address: query, language };
    if (countryCodes.length) {
      params.components = countryCodes.map((c) => `country:${c}`).join('|');
    }

    const data = await this.#call(GEOCODE_URL, params, 'forward geocode');
    const result = data?.results?.[0];
    return result ? this.#toAddress(result) : null;
  }

  async autocomplete({
    query,
    language = 'en',
    lat,
    lng,
    radiusMeters = 50000,
    countryCodes = [],
    sessionToken,
  }) {
    const params = { input: query, language };

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      params.location = `${lat},${lng}`;
      params.radius = radiusMeters;
    }
    if (countryCodes.length) {
      params.components = countryCodes.map((c) => `country:${c}`).join('|');
    }
    if (sessionToken) params.sessiontoken = sessionToken;

    const data = await this.#call(AUTOCOMPLETE_URL, params, 'autocomplete');

    return (data?.predictions || []).map((p) =>
      makeGeoSuggestion({
        id: p.place_id,
        title: p.structured_formatting?.main_text || p.description,
        subtitle: p.structured_formatting?.secondary_text || '',
        description: p.description,
        provider: this.key,
        distanceMeters: p.distance_meters,
      }),
    );
  }

  async placeDetails({ id, language = 'en', sessionToken }) {
    const params = {
      place_id: id,
      language,
      // `plus_code` is billed in the Basic Data SKU alongside the rest of these,
      // so requesting it adds no cost.
      fields: 'place_id,name,formatted_address,geometry,address_component,plus_code',
    };
    if (sessionToken) params.sessiontoken = sessionToken;

    const data = await this.#call(DETAILS_URL, params, 'place details');
    return data?.result ? this.#toAddress(data.result) : null;
  }

  staticMapUrl({ lat, lng, zoom = 16, width = 600, height = 300, scale = 2, marker = true }) {
    if (!this.staticApiKey) return null;

    const params = new URLSearchParams({
      center: `${lat},${lng}`,
      zoom: String(zoom),
      size: `${width}x${height}`,
      scale: String(scale),
      key: this.staticApiKey,
    });
    if (marker) params.append('markers', `color:red|${lat},${lng}`);

    return `${STATIC_URL}?${params.toString()}`;
  }
}

export default GoogleGeoProvider;
