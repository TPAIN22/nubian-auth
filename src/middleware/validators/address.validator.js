import { body, query } from 'express-validator';
import { ADDRESS_LABEL, LOCATION_SOURCE } from '../../services/geo/types.js';

/**
 * Address write validation.
 *
 * Every rule is `.optional()` by design. The address API has always accepted
 * partial payloads — the legacy hierarchy path sends country/city/subcity ids,
 * the map path sends coordinates, and older app builds send neither — so making
 * any single field mandatory here would break a client that is still in the
 * wild. Cross-field requirements (a coordinate pair must be complete, a label
 * must be known) are enforced in the controller where both halves are visible.
 */
const optionalString = (field, max) =>
  body(field).optional({ nullable: true }).isString().trim().isLength({ max })
    .withMessage(`${field} must be at most ${max} characters`);

export const validateAddressWrite = [
  optionalString('name', 100),
  optionalString('phone', 30),
  optionalString('whatsapp', 30),
  optionalString('notes', 500),

  // Map-first inputs
  body('latitude')
    .optional({ nullable: true })
    .isFloat({ min: -90, max: 90 })
    .withMessage('latitude must be between -90 and 90')
    .toFloat(),
  body('longitude')
    .optional({ nullable: true })
    .isFloat({ min: -180, max: 180 })
    .withMessage('longitude must be between -180 and 180')
    .toFloat(),
  optionalString('placeId', 512),
  optionalString('floor', 50),
  optionalString('apartment', 50),
  optionalString('landmark', 200),
  body('addressLabel')
    .optional({ nullable: true })
    .isIn(Object.values(ADDRESS_LABEL))
    .withMessage(`addressLabel must be one of: ${Object.values(ADDRESS_LABEL).join(', ')}`),
  body('locationSource')
    .optional({ nullable: true })
    .isIn(Object.values(LOCATION_SOURCE))
    .withMessage(`locationSource must be one of: ${Object.values(LOCATION_SOURCE).join(', ')}`),
  body('locationAccuracyMeters')
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 100000 })
    .withMessage('locationAccuracyMeters must be a positive distance in metres')
    .toFloat(),
  // Accepted alias so an app build that still sends the old name keeps working.
  body('gpsAccuracyMeters')
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 100000 })
    .withMessage('gpsAccuracyMeters must be a positive distance in metres')
    .toFloat(),

  // Legacy hierarchy inputs — still accepted from older app builds.
  body('countryId').optional({ nullable: true }).isMongoId().withMessage('Invalid countryId'),
  body('cityId').optional({ nullable: true }).isMongoId().withMessage('Invalid cityId'),
  body('subCityId').optional({ nullable: true }).isMongoId().withMessage('Invalid subCityId'),
  optionalString('area', 100),
  optionalString('street', 200),
  optionalString('building', 100),

  body('isDefault').optional({ nullable: true }).isBoolean().toBoolean(),
];

/** Admin list: search, filter, sort, paginate. */
export const validateAdminAddressList = [
  query('search').optional().trim().isLength({ max: 200 }),
  query('countryCode').optional().trim().isLength({ min: 2, max: 2 }).toUpperCase(),
  query('city').optional().trim().isLength({ max: 100 }),
  query('label').optional().isIn(Object.values(ADDRESS_LABEL)),
  query('hasCoordinates').optional().isBoolean().toBoolean(),
  query('isLegacy').optional().isBoolean().toBoolean(),
  query('userId').optional().isMongoId().withMessage('Invalid userId'),

  // Bounding-box filter, for "show me every delivery point in this viewport".
  query('bbox')
    .optional()
    .matches(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
    .withMessage('bbox must be "minLng,minLat,maxLng,maxLat"'),

  query('sortBy')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'city', 'countryCode', 'name'])
    .withMessage('sortBy must be one of: createdAt, updatedAt, city, countryCode, name'),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('page').optional().isInt({ min: 1, max: 10000 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];
