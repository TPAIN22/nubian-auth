import { query } from 'express-validator';
import { handleValidationErrors } from '../validation.middleware.js';

/**
 * Standard pagination validation
 * Limits: page 1-10000, limit 1-100
 */
export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 10000 })
    .withMessage('Page must be between 1 and 10000')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt(),
  handleValidationErrors,
];

