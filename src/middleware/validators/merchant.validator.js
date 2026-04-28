import { body } from 'express-validator';
import {
  sanitizeString,
  validateEmail,
  validatePhone,
  handleValidationErrors,
} from '../validation.middleware.js';

/**
 * Validation for merchant application (POST /api/merchants/apply)
 * Field names match the merchant.model.js schema (storeName, email, phone, etc.)
 */
export const validateMerchantApplication = [
  sanitizeString('storeName',   { min: 2, max: 100 }),
  sanitizeString('ownerName',   { min: 2, max: 100 }),
  validateEmail('email'),
  validatePhone('phone'),
  body('merchantType')
    .isIn(['individual', 'business'])
    .withMessage('merchantType must be "individual" or "business"'),
  sanitizeString('nationalId',  { min: 1, max: 50 }),
  sanitizeString('crNumber',    { min: 0, max: 50, optional: true }),
  sanitizeString('iban',        { min: 1, max: 50 }),
  sanitizeString('description', { min: 1, max: 2000 }),
  sanitizeString('city',        { min: 1, max: 100 }),
  body('categories').optional().isArray().withMessage('categories must be an array'),
  body('productSamples').optional().isArray().withMessage('productSamples must be an array'),
  body('logoUrl').optional().isString().isLength({ max: 1000 }),
  body('banner').optional().isString().isLength({ max: 1000 }),
  handleValidationErrors,
];

/**
 * Validation for merchant profile update (PUT /api/merchants/my-profile)
 * Only the fields the merchant is allowed to self-edit.
 */
export const validateMerchantUpdate = [
  sanitizeString('storeName',   { min: 2, max: 100, optional: true }),
  validateEmail('email', true),
  validatePhone('phone', true),
  sanitizeString('description', { min: 0, max: 2000, optional: true }),
  sanitizeString('city',        { min: 0, max: 100, optional: true }),
  body('logoUrl').optional().isString().isLength({ max: 1000 }),
  body('banner').optional().isString().isLength({ max: 1000 }),
  handleValidationErrors,
];

/**
 * Validation for merchant rejection — body carries rejectionReason.
 */
export const validateMerchantStatusUpdate = [
  body('rejectionReason')
    .optional()
    .trim()
    .isLength({ min: 0, max: 500 })
    .withMessage('Rejection reason must be less than 500 characters'),
  handleValidationErrors,
];

/**
 * Validation for merchant suspension — suspensionReason is required.
 */
export const validateMerchantSuspension = [
  body('suspensionReason')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Suspension reason is required and must be less than 500 characters'),
  handleValidationErrors,
];
