import { body } from 'express-validator';
import {
  validateEnum,
  sanitizeString,
  validateArray,
  validateNumber,
  handleValidationErrors,
} from '../validation.middleware.js';

/**
 * Validation for order status update
 */
export const validateOrderStatusUpdate = [
  body('status')
    .optional()
    .isIn(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'])
    .withMessage('Status must be one of: pending, confirmed, shipped, delivered, cancelled'),
  body('paymentStatus')
    .optional()
    .isIn(['pending', 'paid', 'failed'])
    .withMessage('Payment status must be one of: pending, paid, failed'),
  handleValidationErrors,
];

/**
 * Validation for order creation (from cart)
 */
export const validateOrderCreate = [
  sanitizeString('shippingAddress', { min: 10, max: 500 }),
  sanitizeString('phoneNumber', { min: 5, max: 20 }),
  body('couponCode')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 0, max: 50 })
    .withMessage('Coupon code must be less than 50 characters'),
  handleValidationErrors,
];

