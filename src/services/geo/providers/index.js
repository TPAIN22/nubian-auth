/**
 * Provider registry.
 *
 * Adding a vendor is a two-line change here plus one adapter file. Nothing
 * outside this directory imports a vendor module.
 */
import GoogleGeoProvider from './google.provider.js';
import NominatimGeoProvider from './nominatim.provider.js';
import NullGeoProvider from './null.provider.js';

/** @type {Record<string, typeof import('../GeoProvider.js').GeoProvider>} */
export const PROVIDER_CLASSES = {
  [GoogleGeoProvider.key]: GoogleGeoProvider,
  [NominatimGeoProvider.key]: NominatimGeoProvider,
  [NullGeoProvider.key]: NullGeoProvider,
};

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Per-provider config assembled from env. Keeping this in one place means a
 * provider swap is an env change, not a code change.
 */
export const buildProviderConfig = (key, env = process.env) => {
  const defaultCenter = {
    lat: num(env.GEO_DEFAULT_LAT, 15.5007), // Khartoum
    lng: num(env.GEO_DEFAULT_LNG, 32.5599),
  };

  const shared = {
    defaultCenter,
    defaultZoom: num(env.GEO_DEFAULT_ZOOM, 15),
    timeoutMs: num(env.GEO_TIMEOUT_MS, 6000),
  };

  switch (key) {
    case GoogleGeoProvider.key:
      return {
        ...shared,
        apiKey: env.GEO_GOOGLE_API_KEY || env.GOOGLE_MAPS_API_KEY || '',
        staticApiKey: env.GEO_GOOGLE_STATIC_API_KEY || '',
      };

    case NominatimGeoProvider.key:
      return {
        ...shared,
        baseUrl: env.GEO_NOMINATIM_URL || '',
        apiKey: env.GEO_NOMINATIM_KEY || '',
        email: env.GEO_NOMINATIM_EMAIL || '',
        userAgent: env.GEO_USER_AGENT || '',
        tileUrl: env.GEO_TILE_URL || '',
        styleUrl: env.GEO_STYLE_URL || '',
        attribution: env.GEO_TILE_ATTRIBUTION || '',
        minIntervalMs: env.GEO_NOMINATIM_MIN_INTERVAL_MS
          ? num(env.GEO_NOMINATIM_MIN_INTERVAL_MS, 1100)
          : undefined,
      };

    default:
      return {
        ...shared,
        tileUrl: env.GEO_TILE_URL || '',
        attribution: env.GEO_TILE_ATTRIBUTION || '',
      };
  }
};

/**
 * @param {string} key
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('../GeoProvider.js').GeoProvider|null}
 */
export const createProvider = (key, env = process.env) => {
  const Klass = PROVIDER_CLASSES[key];
  if (!Klass) return null;
  return new Klass(buildProviderConfig(key, env));
};
