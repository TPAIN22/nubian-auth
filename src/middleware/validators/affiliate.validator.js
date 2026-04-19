import { body, param } from 'express-validator';
import { handleValidationErrors } from '../validation.middleware.js';

export const validateAffiliateRegistration = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 3, max: 50 })
    .withMessage('Name must be between 3 and 50 characters'),
  
  body('phone')
    .optional()
    .trim()
    .matches(/^[\d\s\-\+\(\)]+$/)
    .withMessage('Invalid phone number format'),

  handleValidationErrors
];

export const validateReferralTracking = [
  body('referralCode')
    .trim()
    .notEmpty()
    .withMessage('Referral code is required')
    .isUppercase()
    .withMessage('Referral code must be uppercase'),
  
  body('deviceId')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('DeviceId cannot be empty if provided'),

  handleValidationErrors
];

export const validateCommissionPay = [
  param('id')
    .isMongoId()
    .withMessage('Invalid commission ID'),
  
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters'),

  handleValidationErrors
];
