import { validationResult, body, param, query } from 'express-validator';
import logger from '../lib/logger.js';

/**
 * Middleware to handle validation errors
 * Must be called after validation chains
 */
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const requestId = req.requestId || 'unknown';
    logger.warn('Validation failed', {
      requestId,
      errors: errors.array(),
      method: req.method,
      url: req.url,
    });

    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errors.array().map(err => ({
          field: err.path || err.param,
          message: err.msg,
          value: err.value,
        })),
        requestId,
      },
    });
  }
  next();
};

/**
 * Pagination validation middleware
 * Validates and sanitizes pagination parameters
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
];

/**
 * MongoDB ObjectId validation
 */
export const validateObjectId = (field = 'id') => [
  param(field)
    .isMongoId()
    .withMessage(`Invalid ${field} format`),
];

/**
 * Sanitize string inputs to prevent injection
 */
export const sanitizeString = (field, options = {}) => {
  const { min = 0, max = 1000, optional = false } = options;
  let validator = body(field);
  
  if (optional) {
    validator = validator.optional();
  }
  
  return validator
    .trim()
    .escape()
    .isLength({ min, max })
    .withMessage(`${field} must be between ${min} and ${max} characters`);
};

/**
 * Email validation
 */
export const validateEmail = (field = 'email', optional = false) => {
  let validator = body(field);
  if (optional) {
    validator = validator.optional();
  }
  return validator
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail();
};

/**
 * Phone number validation (flexible format)
 */
export const validatePhone = (field = 'phone', optional = false) => {
  let validator = body(field);
  if (optional) {
    validator = validator.optional();
  }
  return validator
    .optional({ nullable: true })
    .matches(/^[\d\s\-\+\(\)]+$/)
    .withMessage('Invalid phone number format')
    .isLength({ min: 0, max: 20 })
    .withMessage('Phone number must be less than 20 characters');
};

/**
 * Numeric validation
 */
export const validateNumber = (field, options = {}) => {
  const { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = options;
  let validator = body(field);
  
  if (optional) {
    validator = validator.optional();
  }
  
  return validator
    .isFloat({ min, max })
    .withMessage(`${field} must be a number between ${min} and ${max}`)
    .toFloat();
};

/**
 * Integer validation
 */
export const validateInteger = (field, options = {}) => {
  const { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = options;
  let validator = body(field);
  
  if (optional) {
    validator = validator.optional();
  }
  
  return validator
    .isInt({ min, max })
    .withMessage(`${field} must be an integer between ${min} and ${max}`)
    .toInt();
};

/**
 * Array validation
 */
export const validateArray = (field, options = {}) => {
  const { min = 0, max = 100, optional = false } = options;
  let validator = body(field);
  
  if (optional) {
    validator = validator.optional();
  }
  
  return validator
    .isArray()
    .withMessage(`${field} must be an array`)
    .isLength({ min, max })
    .withMessage(`${field} must contain between ${min} and ${max} items`);
};

/**
 * URL validation
 */
export const validateURL = (field, optional = false) => {
  let validator = body(field);
  if (optional) {
    validator = validator.optional();
  }
  return validator
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Invalid URL format');
};

/**
 * Enum validation
 */
export const validateEnum = (field, allowedValues, optional = false) => {
  let validator = body(field);
  if (optional) {
    validator = validator.optional();
  }
  return validator
    .isIn(allowedValues)
    .withMessage(`${field} must be one of: ${allowedValues.join(', ')}`);
};

/**
 * Boolean validation
 */
export const validateBoolean = (field, optional = false) => {
  let validator = body(field);
  if (optional) {
    validator = validator.optional();
  }
  return validator
    .isBoolean()
    .withMessage(`${field} must be a boolean`)
    .toBoolean();
};

