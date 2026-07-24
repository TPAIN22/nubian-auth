/**
 * The provider contract every map/geocoding vendor adapter must satisfy.
 *
 * Adding a vendor = one new file under `providers/` extending this class plus a
 * line in the registry (`providers/index.js`). No consumer changes, no schema
 * changes, no mobile release.
 */
import { ServiceError } from '../../lib/errors.js';

export class GeoProviderError extends ServiceError {
  constructor(message, { provider, cause, statusCode = 502, code = 'GEO_PROVIDER_ERROR' } = {}) {
    super(message, code, statusCode);
    this.name = 'GeoProviderError';
    this.provider = provider;
    this.cause = cause;
  }
}

/**
 * Capability flags. The facade consults these before calling a method so an
 * unsupported operation degrades to a documented empty result instead of an
 * exception, and clients can hide UI a provider cannot back (e.g. no
 * autocomplete on a bare OSM deployment).
 *
 * @typedef {Object} GeoCapabilities
 * @property {boolean} reverseGeocode
 * @property {boolean} forwardGeocode
 * @property {boolean} autocomplete
 * @property {boolean} placeDetails
 * @property {boolean} staticMap
 */

export class GeoProvider {
  /**
   * @param {Object} config - Provider-specific config, read from env by the registry.
   */
  constructor(config = {}) {
    this.config = config;
  }

  /** Stable key used in env (`GEO_PROVIDER`), cache keys and persisted records. */
  static get key() {
    throw new Error('GeoProvider subclasses must define a static `key`');
  }

  get key() {
    return /** @type {typeof GeoProvider} */ (this.constructor).key;
  }

  /**
   * @returns {GeoCapabilities}
   */
  get capabilities() {
    return {
      reverseGeocode: false,
      forwardGeocode: false,
      autocomplete: false,
      placeDetails: false,
      staticMap: false,
    };
  }

  /**
   * True when the provider has everything it needs (keys, hosts) to serve
   * traffic. A misconfigured provider is skipped by the fallback chain rather
   * than failing every request.
   * @returns {boolean}
   */
  isConfigured() {
    return false;
  }

  /**
   * Client-facing map configuration. Deliberately vendor-shaped-but-neutral:
   * clients receive a style/tile URL and attribution and render with whatever
   * map engine they use. Never include a secret here — this is public.
   *
   * @returns {{ provider: string, styleUrl: string|null, tileUrl: string|null,
   *             attribution: string, maxZoom: number, defaultCenter: {lat:number,lng:number},
   *             defaultZoom: number }}
   */
  getClientConfig() {
    return {
      provider: this.key,
      styleUrl: null,
      tileUrl: null,
      attribution: '',
      maxZoom: 19,
      defaultCenter: this.config.defaultCenter,
      defaultZoom: this.config.defaultZoom ?? 15,
    };
  }

  /**
   * Coordinates → address.
   * @param {{ lat:number, lng:number, language?:string }} _params
   * @returns {Promise<import('./types.js').GeoAddress|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async reverseGeocode(_params) {
    throw new GeoProviderError('reverseGeocode not supported', { provider: this.key, statusCode: 501 });
  }

  /**
   * Free text → best-matching address.
   * @param {{ query:string, language?:string, countryCodes?:string[] }} _params
   * @returns {Promise<import('./types.js').GeoAddress|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async forwardGeocode(_params) {
    throw new GeoProviderError('forwardGeocode not supported', { provider: this.key, statusCode: 501 });
  }

  /**
   * Type-ahead search over cities, streets, landmarks, businesses, neighbourhoods.
   * @param {{ query:string, language?:string, lat?:number, lng?:number,
   *           radiusMeters?:number, countryCodes?:string[], sessionToken?:string }} _params
   * @returns {Promise<import('./types.js').GeoSuggestion[]>}
   */
  // eslint-disable-next-line no-unused-vars
  async autocomplete(_params) {
    throw new GeoProviderError('autocomplete not supported', { provider: this.key, statusCode: 501 });
  }

  /**
   * Resolve a suggestion id from `autocomplete` into a full address with coords.
   * @param {{ id:string, language?:string, sessionToken?:string }} _params
   * @returns {Promise<import('./types.js').GeoAddress|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async placeDetails(_params) {
    throw new GeoProviderError('placeDetails not supported', { provider: this.key, statusCode: 501 });
  }

  /**
   * URL of a static map image. Returned by the backend so dashboards can render
   * a preview without holding a vendor key.
   * @param {{ lat:number, lng:number, zoom?:number, width?:number, height?:number,
   *           scale?:number, marker?:boolean }} _params
   * @returns {string|null}
   */
  // eslint-disable-next-line no-unused-vars
  staticMapUrl(_params) {
    return null;
  }
}

export default GeoProvider;
