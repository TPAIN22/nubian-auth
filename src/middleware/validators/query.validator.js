import { query } from 'express-validator';
import { handleValidationErrors } from '../validation.middleware.js';

/**
 * Validate MongoDB ObjectId in query parameters
 */
export const validateObjectIdQuery = (field = 'id') => [
  query(field)
    .optional()
    .isMongoId()
    .withMessage(`${field} must be a valid MongoDB ID`),
  handleValidationErrors,
];

/**
 * Validate category filter (MongoDB ObjectId)
 */
export const validateCategoryFilter = [
  query('category')
    .optional()
    .isMongoId()
    .withMessage('Category must be a valid MongoDB ID'),
  handleValidationErrors,
];

/**
 * Validate merchant filter (MongoDB ObjectId)
 */
export const validateMerchantFilter = [
  query('merchant')
    .optional()
    .isMongoId()
    .withMessage('Merchant must be a valid MongoDB ID'),
  handleValidationErrors,
];

/**
 * Validate boolean query parameter
 */
export const validateBooleanQuery = (field, optional = true) => [
  query(field)
    .optional({ checkFalsy: optional })
    .isBoolean()
    .withMessage(`${field} must be a boolean`)
    .toBoolean(),
  handleValidationErrors,
];

/**
 * Validate status filter (enum)
 */
export const validateStatusFilter = (allowedStatuses, field = 'status') => [
  query(field)
    .optional()
    .isIn(allowedStatuses)
    .withMessage(`${field} must be one of: ${allowedStatuses.join(', ')}`),
  handleValidationErrors,
];

