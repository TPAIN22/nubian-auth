import { body } from 'express-validator';
import {
  sanitizeString,
  validateEmail,
  validatePhone,
  handleValidationErrors,
} from '../validation.middleware.js';

/**
 * Validation for merchant application
 */
export const validateMerchantApplication = [
  sanitizeString('businessName', { min: 2, max: 100 }),
  validateEmail('businessEmail'),
  validatePhone('businessPhone', true),
  sanitizeString('businessDescription', { min: 0, max: 1000, optional: true }),
  sanitizeString('businessAddress', { min: 0, max: 500, optional: true }),
  handleValidationErrors,
];

/**
 * Validation for merchant profile update
 */
export const validateMerchantUpdate = [
  sanitizeString('businessName', { min: 2, max: 100, optional: true }),
  validateEmail('businessEmail', true),
  validatePhone('businessPhone', true),
  sanitizeString('businessDescription', { min: 0, max: 1000, optional: true }),
  sanitizeString('businessAddress', { min: 0, max: 500, optional: true }),
  handleValidationErrors,
];

/**
 * Validation for merchant approval/rejection
 */
export const validateMerchantStatusUpdate = [
  body('status')
    .optional()
    .isIn(['APPROVED', 'REJECTED', 'PENDING'])
    .withMessage('Status must be APPROVED, REJECTED, or PENDING'),
  body('rejectionReason')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 0, max: 500 })
    .withMessage('Rejection reason must be less than 500 characters'),
  handleValidationErrors,
];

/**
 * Validation for merchant suspension
 */
export const validateMerchantSuspension = [
  body('suspensionReason')
    .trim()
    .escape()
    .isLength({ min: 1, max: 500 })
    .withMessage('Suspension reason is required and must be less than 500 characters'),
  handleValidationErrors,
];

