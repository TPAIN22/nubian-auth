import { query, param } from 'express-validator';

/** Two-letter ISO language tag ('en', 'ar'), optionally regioned ('ar-SD'). */
const language = query('language')
  .optional()
  .trim()
  .matches(/^[a-zA-Z]{2}(-[a-zA-Z]{2,4})?$/)
  .withMessage('language must be an ISO language tag, e.g. "en" or "ar"');

export const validateReverseGeocode = [
  query('lat')
    .exists()
    .withMessage('lat is required')
    .isFloat({ min: -90, max: 90 })
    .withMessage('lat must be between -90 and 90')
    .toFloat(),
  query('lng')
    .exists()
    .withMessage('lng is required')
    .isFloat({ min: -180, max: 180 })
    .withMessage('lng must be between -180 and 180')
    .toFloat(),
  language,
];

export const validateGeoSearch = [
  query('q')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('q must be between 2 and 200 characters'),
  query('lat').optional().isFloat({ min: -90, max: 90 }).toFloat(),
  query('lng').optional().isFloat({ min: -180, max: 180 }).toFloat(),
  query('radius')
    .optional()
    .isInt({ min: 100, max: 500000 })
    .withMessage('radius must be between 100 and 500000 metres')
    .toInt(),
  // Opaque provider billing-session token. Never interpreted here, so it is
  // length-capped and character-restricted rather than parsed.
  query('sessionToken')
    .optional()
    .trim()
    .isLength({ max: 128 })
    .matches(/^[\w-]*$/)
    .withMessage('sessionToken must be alphanumeric'),
  language,
];

export const validatePlaceDetails = [
  param('placeId')
    .trim()
    .isLength({ min: 1, max: 512 })
    .withMessage('placeId is required'),
  query('sessionToken')
    .optional()
    .trim()
    .isLength({ max: 128 })
    .matches(/^[\w-]*$/)
    .withMessage('sessionToken must be alphanumeric'),
  language,
];

export const validateStaticMap = [
  query('lat')
    .exists()
    .withMessage('lat is required')
    .isFloat({ min: -90, max: 90 })
    .toFloat(),
  query('lng')
    .exists()
    .withMessage('lng is required')
    .isFloat({ min: -180, max: 180 })
    .toFloat(),
  query('zoom').optional().isInt({ min: 1, max: 21 }).toInt(),
  query('width').optional().isInt({ min: 64, max: 1280 }).toInt(),
  query('height').optional().isInt({ min: 64, max: 1280 }).toInt(),
];
