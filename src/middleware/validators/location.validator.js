import { body, param, query } from 'express-validator';
import Country from '../../models/country.model.js';
import City from '../../models/city.model.js';
import SubCity from '../../models/subcity.model.js';

// Country validation (for create)
export const validateCountry = [
  body('code')
    .trim()
    .isLength({ min: 2, max: 3 })
    .withMessage('Country code must be 2-3 characters')
    .isAlpha()
    .withMessage('Country code must contain only letters')
    .toUpperCase(),

  body('nameAr')
    .trim()
    .notEmpty()
    .withMessage('Arabic name is required')
    .isLength({ max: 100 })
    .withMessage('Arabic name must be less than 100 characters'),

  body('nameEn')
    .trim()
    .notEmpty()
    .withMessage('English name is required')
    .isLength({ max: 100 })
    .withMessage('English name must be less than 100 characters'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),

  body('sortOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('sortOrder must be a non-negative integer')
    .toInt()
];

// Country update validation (allows partial updates)
export const validateCountryUpdate = [
  body('code')
    .optional()
    .trim()
    .isLength({ min: 2, max: 3 })
    .withMessage('Country code must be 2-3 characters')
    .isAlpha()
    .withMessage('Country code must contain only letters')
    .toUpperCase(),

  body('nameAr')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Arabic name must be less than 100 characters'),

  body('nameEn')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('English name must be less than 100 characters'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),

  body('sortOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('sortOrder must be a non-negative integer')
    .toInt()
];

// City validation (for create)
export const validateCity = [
  body('nameAr')
    .trim()
    .notEmpty()
    .withMessage('Arabic name is required')
    .isLength({ max: 100 })
    .withMessage('Arabic name must be less than 100 characters'),

  body('nameEn')
    .trim()
    .notEmpty()
    .withMessage('English name is required')
    .isLength({ max: 100 })
    .withMessage('English name must be less than 100 characters'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),

  body('sortOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('sortOrder must be a non-negative integer')
    .toInt()
];

// City update validation (allows partial updates)
export const validateCityUpdate = [
  body('nameAr')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Arabic name must be less than 100 characters'),

  body('nameEn')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('English name must be less than 100 characters'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),

  body('sortOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('sortOrder must be a non-negative integer')
    .toInt()
];

// SubCity validation (for create)
export const validateSubCity = [
  body('nameAr')
    .trim()
    .notEmpty()
    .withMessage('Arabic name is required')
    .isLength({ max: 100 })
    .withMessage('Arabic name must be less than 100 characters'),

  body('nameEn')
    .trim()
    .notEmpty()
    .withMessage('English name is required')
    .isLength({ max: 100 })
    .withMessage('English name must be less than 100 characters'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),

  body('sortOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('sortOrder must be a non-negative integer')
    .toInt()
];

// SubCity update validation (allows partial updates)
export const validateSubCityUpdate = [
  body('nameAr')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Arabic name must be less than 100 characters'),

  body('nameEn')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('English name must be less than 100 characters'),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),

  body('sortOrder')
    .optional()
    .isInt({ min: 0 })
    .withMessage('sortOrder must be a non-negative integer')
    .toInt()
];

// Parameter validation for IDs
export const validateCountryId = [
  param('countryId')
    .isMongoId()
    .withMessage('Invalid country ID')
];

export const validateCityId = [
  param('cityId')
    .isMongoId()
    .withMessage('Invalid city ID')
];

export const validateSubCityId = [
  param('subCityId')
    .isMongoId()
    .withMessage('Invalid subCity ID')
];

// Query validation for active filter
export const validateActiveQuery = [
  query('active')
    .optional()
    .isBoolean()
    .withMessage('active must be a boolean')
    .toBoolean()
];