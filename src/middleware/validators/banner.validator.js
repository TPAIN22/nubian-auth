import { body } from 'express-validator';
import { validateBannerTarget } from '../../lib/bannerTarget.js';

/**
 * Banner write validation.
 *
 * Before this existed both `POST /banners` and `PUT /banners/:id` passed
 * `req.body` straight into Mongoose, so an unknown field was silently dropped
 * and a malformed one produced a 500. Now the shape is checked up front and
 * `handleValidationErrors` returns the standard VALIDATION_ERROR envelope.
 */

const imageUrl = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('image is required')
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('image must be an absolute http(s) URL');

const optionalText = (field, max) =>
  body(field)
    .optional({ nullable: true })
    .trim()
    .isLength({ max })
    .withMessage(`${field} must be at most ${max} characters`);

const order = body('order')
  .optional()
  .isInt({ min: 0, max: 100000 })
  .withMessage('order must be a non-negative integer')
  .toInt();

const isActive = body('isActive')
  .optional()
  .isBoolean()
  .withMessage('isActive must be a boolean')
  .toBoolean();

/**
 * Cross-field target check, delegated wholesale to `lib/bannerTarget.js` so the
 * legal combinations are defined in exactly one place.
 *
 * `.customSanitizer` then replaces the submitted object with the canonical one,
 * which is what strips unknown keys and trims the URL before it reaches the
 * controller — the controller can persist `req.body.target` as-is.
 */
const target = body('target')
  .optional({ nullable: true })
  .custom((value) => {
    const result = validateBannerTarget(value);
    if (!result.ok) throw new Error(result.message);
    return true;
  })
  .customSanitizer((value) => {
    const result = validateBannerTarget(value);
    return result.ok ? result.value : value;
  });

export const validateBannerCreate = [
  imageUrl(body('image')),
  optionalText('title', 200),
  optionalText('description', 500),
  order,
  isActive,
  target,
];

/**
 * Update is a partial: an admin toggling `isActive` must not have to resend the
 * image. `target` is still fully validated whenever it is present, and sending
 * `{ target: { type: 'none' } }` is how a target is removed.
 */
export const validateBannerUpdate = [
  imageUrl(body('image').optional()),
  optionalText('title', 200),
  optionalText('description', 500),
  order,
  isActive,
  target,
];
