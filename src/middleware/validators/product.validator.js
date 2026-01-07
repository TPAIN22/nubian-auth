import { body } from 'express-validator';
import {
  sanitizeString,
  validateNumber,
  validateInteger,
  validateArray,
  validateURL,
  validateBoolean,
  validateEnum,
  handleValidationErrors,
} from '../validation.middleware.js';

// Custom validator to check if images array has valid URLs
const validateImagesArray = body('images')
  .custom((value) => {
    if (!Array.isArray(value)) {
      throw new Error('images must be an array');
    }
    if (value.length < 1 || value.length > 10) {
      throw new Error('images must contain between 1 and 10 items');
    }
    // Validate each URL
    for (const url of value) {
      if (typeof url !== 'string' || url.trim().length === 0) {
        throw new Error('Each image must be a non-empty string');
      }
      // Basic URL validation (express-validator will do more detailed check)
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('Each image must be a valid URL starting with http:// or https://');
      }
    }
    return true;
  });

/**
 * Validation for product creation
 */
export const validateProductCreate = [
  sanitizeString('name', { min: 2, max: 200 }),
  sanitizeString('description', { min: 1, max: 5000 }), // Required by model, not optional
  validateNumber('price', { min: 0.01, max: 1000000 }), // Min should be 0.01 per model
  validateNumber('discountPrice', { min: 0, max: 1000000, optional: true }),
  validateInteger('stock', { min: 0, max: 100000 }),
  // Use custom validator for images to avoid conflicts between array and item validation
  validateImagesArray,
  // Additional URL validation for each image
  body('images.*')
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Each image must be a valid URL'),
  validateArray('sizes', { min: 0, max: 20, optional: true }),
  body('sizes.*')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 1, max: 50 })
    .withMessage('Each size must be between 1 and 50 characters'),
  body('category')
    .notEmpty()
    .withMessage('Category is required')
    .isMongoId()
    .withMessage('Category must be a valid MongoDB ID'),
  validateBoolean('isActive', true), // true = optional
  handleValidationErrors,
];

/**
 * Validation for product update
 */
export const validateProductUpdate = [
  sanitizeString('name', { min: 2, max: 200, optional: true }),
  sanitizeString('description', { min: 0, max: 5000, optional: true }),
  validateNumber('price', { min: 0, max: 1000000, optional: true }),
  validateNumber('discountPrice', { min: 0, max: 1000000, optional: true }),
  validateInteger('stock', { min: 0, max: 100000, optional: true }),
  validateArray('images', { min: 0, max: 10, optional: true }),
  body('images.*')
    .optional()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Each image must be a valid URL'),
  validateArray('sizes', { min: 0, max: 20, optional: true }),
  body('sizes.*')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 1, max: 50 })
    .withMessage('Each size must be between 1 and 50 characters'),
  body('category')
    .optional()
    .isMongoId()
    .withMessage('Category must be a valid MongoDB ID'),
  validateBoolean('isActive', true),
  handleValidationErrors,
];

