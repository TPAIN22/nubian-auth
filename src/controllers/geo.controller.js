/**
 * Geo proxy endpoints.
 *
 * Every client-side map/geocoding need is served from here so that:
 *   - vendor API keys stay on the server, never in an app bundle or a browser
 *   - switching provider is an env change with no app release
 *   - caching, quotas and abuse control live in one place
 */
import axios from 'axios';
import { getGeoService } from '../services/geo/index.js';
import { sendError, sendSuccess } from '../lib/response.js';
import logger from '../lib/logger.js';

const GENERIC_ERROR = 'Location service unavailable';

/**
 * Public map configuration — provider key, tile/style URL, attribution,
 * capabilities and the debounce timings clients should honour.
 * Contains no secrets by construction (see `GeoProvider#getClientConfig`).
 */
export const getConfig = async (req, res) => {
  try {
    return sendSuccess(res, {
      data: getGeoService().getClientConfig(),
      message: 'Map configuration retrieved successfully',
    });
  } catch (error) {
    logger.error('geo.getConfig failed', {
      requestId: req.requestId,
      error: error.message,
    });
    return sendError(res, { message: GENERIC_ERROR, code: 'GEO_CONFIG_ERROR' });
  }
};

/**
 * GET /api/geo/reverse?lat=&lng=&language=
 * Always 200 with an address — when no provider can label the pin, the address
 * carries the coordinates and an empty `formattedAddress` so the client can
 * still let the shopper describe the place.
 */
export const reverseGeocode = async (req, res) => {
  const { lat, lng, language } = req.query;

  try {
    const address = await getGeoService().reverseGeocode({ lat, lng, language });

    return sendSuccess(res, {
      data: address,
      message: 'Address resolved successfully',
    });
  } catch (error) {
    if (error.code === 'INVALID_COORDINATES') {
      return sendError(res, {
        message: 'Invalid coordinates',
        code: 'INVALID_COORDINATES',
        statusCode: 400,
      });
    }

    logger.error('geo.reverseGeocode failed', {
      requestId: req.requestId,
      lat,
      lng,
      error: error.message,
    });
    return sendError(res, { message: GENERIC_ERROR, code: 'GEO_REVERSE_ERROR' });
  }
};

/**
 * GET /api/geo/search?q=&lat=&lng=&radius=&language=
 * Autocomplete over cities, streets, landmarks, businesses and neighbourhoods.
 * Degrades to an empty list rather than an error so the search box never breaks.
 */
export const search = async (req, res) => {
  const { q, lat, lng, radius, language, sessionToken } = req.query;

  try {
    const results = await getGeoService().autocomplete({
      query: q,
      lat,
      lng,
      radiusMeters: radius,
      language,
      sessionToken,
    });

    return sendSuccess(res, {
      data: results,
      message: 'Search results retrieved successfully',
    });
  } catch (error) {
    logger.error('geo.search failed', {
      requestId: req.requestId,
      query: q,
      error: error.message,
    });
    return sendSuccess(res, { data: [], message: 'No results' });
  }
};

/**
 * GET /api/geo/place/:placeId?language=
 * Resolves a search suggestion into a full address with coordinates.
 */
export const placeDetails = async (req, res) => {
  const { placeId } = req.params;
  const { language, sessionToken } = req.query;

  try {
    const address = await getGeoService().placeDetails({
      id: placeId,
      language,
      sessionToken,
    });

    if (!address) {
      return sendError(res, {
        message: 'Place not found',
        code: 'PLACE_NOT_FOUND',
        statusCode: 404,
      });
    }

    return sendSuccess(res, {
      data: address,
      message: 'Place resolved successfully',
    });
  } catch (error) {
    logger.error('geo.placeDetails failed', {
      requestId: req.requestId,
      placeId,
      error: error.message,
    });
    return sendError(res, { message: GENERIC_ERROR, code: 'GEO_PLACE_ERROR' });
  }
};

/**
 * GET /api/geo/static?lat=&lng=&zoom=&width=&height=
 *
 * Streams a static map image through the API. The upstream URL embeds the
 * vendor key, so it is fetched server-side and only the bytes are returned —
 * the dashboard can render map previews without ever holding a key.
 *
 * Responds 404 when no configured provider offers static images; callers should
 * fall back to an interactive or placeholder preview.
 */
export const staticMap = async (req, res) => {
  const { lat, lng, zoom, width, height } = req.query;

  const url = getGeoService().staticMapUrl({
    lat,
    lng,
    zoom: zoom ?? 16,
    width: width ?? 600,
    height: height ?? 300,
  });

  if (!url) {
    return sendError(res, {
      message: 'Static maps are not available for the configured provider',
      code: 'STATIC_MAP_UNAVAILABLE',
      statusCode: 404,
    });
  }

  try {
    const upstream = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 8000,
    });

    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/png');
    // Long cache: a static map of a fixed coordinate never changes meaningfully.
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return res.status(200).send(Buffer.from(upstream.data));
  } catch (error) {
    logger.error('geo.staticMap failed', {
      requestId: req.requestId,
      lat,
      lng,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to render map preview',
      code: 'GEO_STATIC_ERROR',
      statusCode: 502,
    });
  }
};

/** Admin diagnostics: active chain, capabilities and cache hit rate. */
export const getStats = async (req, res) => {
  return sendSuccess(res, {
    data: getGeoService().stats(),
    message: 'Geo service stats retrieved successfully',
  });
};
