import { body } from 'express-validator';

import { handleValidationErrors } from '../validation.middleware.js';

/**
 * Validation for PUT /api/merchants/onboarding.
 *
 * Every field is optional — the tour sends a partial patch (usually just
 * `currentStep`, or just `status`) and the controller merges it.
 *
 * Step ids are constrained to a slug shape and the array to a small cap rather
 * than checked against a hard-coded list. The step list belongs to the
 * dashboard and changes with it; pinning the enum here would mean a copy change
 * in the frontend needs a backend deploy to stop 400ing. The cap is what stops
 * the field being used as free storage.
 */
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_COMPLETED_STEPS = 32;

export const validateMerchantOnboarding = [
  body('status')
    .optional()
    .isIn(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'])
    .withMessage('status must be NOT_STARTED, IN_PROGRESS, COMPLETED or SKIPPED'),

  body('currentStep')
    .optional({ nullable: true })
    .custom((value) => value === null || value === '' || STEP_ID.test(String(value)))
    .withMessage('currentStep must be a lowercase slug of at most 64 characters'),

  body('completedSteps')
    .optional()
    .isArray({ max: MAX_COMPLETED_STEPS })
    .withMessage(`completedSteps must be an array of at most ${MAX_COMPLETED_STEPS} ids`)
    .bail()
    .custom((value) => value.every((id) => typeof id === 'string' && STEP_ID.test(id)))
    .withMessage('completedSteps must contain lowercase slugs of at most 64 characters'),

  body('version')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('version must be an integer between 1 and 1000')
    .toInt(),

  handleValidationErrors,
];
