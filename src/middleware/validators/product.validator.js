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

/**
 * Validation for product creation
 */
export const validateProductCreate = [
  sanitizeString('name', { min: 2, max: 200 }),
  sanitizeString('description', { min: 0, max: 5000, optional: true }),
  validateNumber('price', { min: 0, max: 1000000 }),
  validateNumber('discountPrice', { min: 0, max: 1000000, optional: true }),
  validateInteger('stock', { min: 0, max: 100000 }),
  validateArray('images', { min: 1, max: 10 }),
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
    .optional()
    .isMongoId()
    .withMessage('Category must be a valid MongoDB ID'),
  validateBoolean('isActive', true),
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

