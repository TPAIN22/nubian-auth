import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getConfig,
  getStats,
  placeDetails,
  reverseGeocode,
  search,
  staticMap,
} from '../controllers/geo.controller.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import { handleValidationErrors } from '../middleware/validation.middleware.js';
import {
  validateGeoSearch,
  validatePlaceDetails,
  validateReverseGeocode,
  validateStaticMap,
} from '../middleware/validators/geo.validator.js';

const router = express.Router();

/**
 * Geocoding calls are metered and billed upstream, so they get a tighter budget
 * than the global `/api` limiter. The numbers assume the client debounces (it
 * is told to by `/api/geo/config`): a shopper picking one address makes roughly
 * 5–15 reverse calls and a handful of searches.
 */
const geoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  message: 'Too many location requests, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Public: clients need this before they can render a map, including on the
// sign-up path where no session exists yet. Contains no secrets.
router.get('/config', getConfig);

// Authenticated: these cost money per call.
router.get(
  '/reverse',
  geoLimiter,
  isAuthenticated,
  validateReverseGeocode,
  handleValidationErrors,
  reverseGeocode,
);

router.get(
  '/search',
  geoLimiter,
  isAuthenticated,
  validateGeoSearch,
  handleValidationErrors,
  search,
);

router.get(
  '/place/:placeId',
  geoLimiter,
  isAuthenticated,
  validatePlaceDetails,
  handleValidationErrors,
  placeDetails,
);

// Image proxy for dashboard/admin map previews — keeps the vendor key server-side.
router.get(
  '/static',
  geoLimiter,
  isAuthenticated,
  validateStaticMap,
  handleValidationErrors,
  staticMap,
);

router.get('/stats', isAuthenticated, isAdmin, getStats);

export default router;
