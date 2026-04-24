import { query } from 'express-validator';
import { handleValidationErrors } from '../validation.middleware.js';

// Max page 500 × limit 100 = 50k records max per paginated endpoint.
// MongoDB cursor skips are O(n) — page 10000 would scan ~1M documents.
// For deep pagination use cursor-based approach (after: <lastId>).
export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('Page must be between 1 and 500')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt(),
  handleValidationErrors,
];
