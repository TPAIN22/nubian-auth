/**
 * The geo facade — the single entry point the rest of the platform uses.
 *
 *   import geoService from '../services/geo/index.js';
 *   const address = await geoService.reverseGeocode({ lat, lng });
 *
 * Responsibilities that belong here, not in a provider:
 *   - choosing the active provider and the fallback chain (env driven)
 *   - caching
 *   - request coalescing (identical concurrent lookups share one upstream call)
 *   - graceful degradation when every provider fails
 *
 * Consumers never import a provider directly, never see a vendor payload, and
 * never hold a vendor key. Swapping vendors is `GEO_PROVIDER=<key>` + a redeploy.
 */
import logger from '../../lib/logger.js';
import { createProvider, PROVIDER_CLASSES } from './providers/index.js';
import { TtlCache, placeKey, reverseKey, searchKey } from './cache.js';
import { isValidCoordinate, makeGeoAddress } from './types.js';

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const parseList = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

class GeoService {
  constructor(env = process.env) {
    this.env = env;

    const primaryKey = env.GEO_PROVIDER || 'none';
    const fallbackKeys = parseList(env.GEO_FALLBACK_PROVIDERS);

    /** Ordered, de-duplicated, configured providers. */
    this.chain = [primaryKey, ...fallbackKeys, 'none']
      .filter((key, i, all) => all.indexOf(key) === i)
      .map((key) => {
        const provider = createProvider(key, env);
        if (!provider) {
          logger.warn('geo: unknown provider key, skipping', {
            key,
            known: Object.keys(PROVIDER_CLASSES),
          });
          return null;
        }
        if (!provider.isConfigured()) {
          logger.warn('geo: provider not configured, skipping', { key });
          return null;
        }
        return provider;
      })
      .filter(Boolean);

    this.primary = this.chain[0] ?? null;

    this.cache = new TtlCache({
      maxEntries: num(env.GEO_CACHE_MAX_ENTRIES, 5000),
      ttlMs: num(env.GEO_CACHE_TTL_MS, 24 * 60 * 60 * 1000),
    });

    // Autocomplete results churn far faster than reverse-geocode labels.
    this.searchTtlMs = num(env.GEO_SEARCH_CACHE_TTL_MS, 10 * 60 * 1000);

    /** @type {Map<string, Promise<unknown>>} in-flight de-duplication */
    this.inFlight = new Map();

    this.defaultLanguage = env.GEO_DEFAULT_LANGUAGE || 'en';
    this.countryCodes = parseList(env.GEO_COUNTRY_CODES).map((c) => c.toLowerCase());

    logger.info('geo: provider chain initialised', {
      chain: this.chain.map((p) => p.key),
    });
  }

  get providerKey() {
    return this.primary?.key ?? 'none';
  }

  /** True when at least one configured provider can do real geocoding. */
  get isEnabled() {
    return this.chain.some((p) => p.key !== 'none');
  }

  /**
   * Public, secret-free map configuration for clients.
   * Mobile/dashboard read this at boot so a provider swap needs no app release.
   */
  getClientConfig() {
    const provider = this.primary;
    const capabilities = provider?.capabilities ?? {
      reverseGeocode: false,
      forwardGeocode: false,
      autocomplete: false,
      placeDetails: false,
      staticMap: false,
    };

    return {
      ...(provider?.getClientConfig() ?? {}),
      provider: this.providerKey,
      capabilities,
      countryCodes: this.countryCodes,
      // Client-side debounce is a UX/cost knob the server owns, so it can be
      // tuned per provider without shipping a new build.
      reverseGeocodeDebounceMs: num(this.env.GEO_CLIENT_DEBOUNCE_MS, 500),
      searchDebounceMs: num(this.env.GEO_CLIENT_SEARCH_DEBOUNCE_MS, 350),
    };
  }

  /**
   * Run `operation` against each provider in turn until one returns.
   * A provider that throws is logged and skipped; the caller only ever sees a
   * result or `fallbackValue`.
   */
  async #withFallback(capability, operation, fallbackValue) {
    const errors = [];

    for (const provider of this.chain) {
      if (!provider.capabilities[capability]) continue;

      try {
        return await operation(provider);
      } catch (err) {
        errors.push({ provider: provider.key, message: err.message });
        logger.warn('geo: provider call failed, trying next', {
          provider: provider.key,
          capability,
          error: err.message,
        });
      }
    }

    if (errors.length) {
      logger.error('geo: every provider failed', { capability, errors });
    }

    return fallbackValue;
  }

  /** Collapse identical concurrent lookups into a single upstream request. */
  async #coalesce(key, factory) {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = factory().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Coordinates → address.
   *
   * Always resolves. When no provider can label the point, the returned address
   * still carries the coordinates so the shopper can save a usable pin.
   *
   * @param {{ lat:number, lng:number, language?:string }} params
   * @returns {Promise<import('./types.js').GeoAddress>}
   */
  async reverseGeocode({ lat, lng, language = this.defaultLanguage }) {
    if (!isValidCoordinate(lat, lng)) {
      throw Object.assign(new Error('Invalid coordinates'), {
        code: 'INVALID_COORDINATES',
        statusCode: 400,
      });
    }

    const key = reverseKey(this.providerKey, lat, lng, language);
    const cached = this.cache.get(key);
    if (cached) return cached;

    return this.#coalesce(key, async () => {
      const result = await this.#withFallback(
        'reverseGeocode',
        (provider) => provider.reverseGeocode({ lat, lng, language }),
        null,
      );

      // Preserve the exact pin the user chose. Providers snap to the nearest
      // feature centroid, which would silently move the delivery point.
      const address = makeGeoAddress({
        ...(result || {}),
        lat,
        lng,
        provider: result?.provider || this.providerKey,
      });

      if (address.formattedAddress) this.cache.set(key, address);
      return address;
    });
  }

  /**
   * Free text → best matching address, or null.
   * @param {{ query:string, language?:string, countryCodes?:string[] }} params
   */
  async forwardGeocode({ query, language = this.defaultLanguage, countryCodes }) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return null;

    return this.#withFallback(
      'forwardGeocode',
      (provider) =>
        provider.forwardGeocode({
          query: trimmed,
          language,
          countryCodes: countryCodes ?? this.countryCodes,
        }),
      null,
    );
  }

  /**
   * Type-ahead search across cities, streets, landmarks, businesses and
   * neighbourhoods. Returns [] rather than throwing so the search box degrades
   * to "no results" instead of an error state.
   *
   * @param {{ query:string, language?:string, lat?:number, lng?:number,
   *           radiusMeters?:number, countryCodes?:string[], sessionToken?:string }} params
   * @returns {Promise<import('./types.js').GeoSuggestion[]>}
   */
  async autocomplete({
    query,
    language = this.defaultLanguage,
    lat,
    lng,
    radiusMeters = 50000,
    countryCodes,
    sessionToken,
  }) {
    const trimmed = String(query || '').trim();
    if (trimmed.length < 2) return [];

    const key = searchKey(this.providerKey, trimmed, language, lat, lng);
    const cached = this.cache.get(key);
    if (cached) return cached;

    return this.#coalesce(key, async () => {
      const results = await this.#withFallback(
        'autocomplete',
        (provider) =>
          provider.autocomplete({
            query: trimmed,
            language,
            lat: Number(lat),
            lng: Number(lng),
            radiusMeters,
            countryCodes: countryCodes ?? this.countryCodes,
            sessionToken,
          }),
        [],
      );

      if (results.length) this.cache.set(key, results, this.searchTtlMs);
      return results;
    });
  }

  /**
   * Resolve a suggestion id into a full address with coordinates.
   * @param {{ id:string, language?:string, sessionToken?:string }} params
   */
  async placeDetails({ id, language = this.defaultLanguage, sessionToken }) {
    const trimmed = String(id || '').trim();
    if (!trimmed) return null;

    const key = placeKey(this.providerKey, trimmed, language);
    const cached = this.cache.get(key);
    if (cached) return cached;

    return this.#coalesce(key, async () => {
      const result = await this.#withFallback(
        'placeDetails',
        (provider) => provider.placeDetails({ id: trimmed, language, sessionToken }),
        null,
      );

      if (result) this.cache.set(key, result);
      return result;
    });
  }

  /**
   * Static map image URL, or null when no provider supports one.
   * The URL embeds a vendor key, so only ever hand it to trusted (admin)
   * surfaces or proxy it — see `geo.controller.js`.
   */
  staticMapUrl(params) {
    if (!isValidCoordinate(params?.lat, params?.lng)) return null;

    for (const provider of this.chain) {
      if (!provider.capabilities.staticMap) continue;
      const url = provider.staticMapUrl(params);
      if (url) return url;
    }
    return null;
  }

  /** Diagnostics for the admin health surface. */
  stats() {
    return {
      provider: this.providerKey,
      chain: this.chain.map((p) => ({
        key: p.key,
        capabilities: p.capabilities,
      })),
      cache: this.cache.stats(),
      inFlight: this.inFlight.size,
    };
  }
}

/**
 * Singleton, constructed lazily on first use.
 *
 * Lazy rather than at module load so `dotenv` has always run by the time the
 * provider chain reads env, and so tests can inject a stubbed env without
 * caring about import order.
 */
let instance = null;

/**
 * @param {NodeJS.ProcessEnv} [env] - pass an env to force a fresh instance (tests only)
 * @returns {GeoService}
 */
export const getGeoService = (env) => {
  if (!instance || env) instance = new GeoService(env);
  return instance;
};

/** Test seam — drops the memoised singleton. */
export const resetGeoService = () => {
  instance = null;
};

export { GeoService };
export default getGeoService;
