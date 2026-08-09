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
 * Validation for admin-created stores (POST /api/merchants/admin/stores)
 *
 * Deliberately looser than validateMerchantApplication: an admin onboarding a
 * seller who has not registered has no nationalId, IBAN, or phone yet. Those are
 * collected from the owner after they claim the store.
 */
export const validateAdminStoreCreate = [
  sanitizeString('storeName',   { min: 2, max: 100 }),
  sanitizeString('ownerName',   { min: 2, max: 100 }),
  validateEmail('email'),
  validatePhone('phone', true),
  body('merchantType')
    .optional()
    .isIn(['individual', 'business'])
    .withMessage('merchantType must be "individual" or "business"'),
  sanitizeString('nationalId',  { min: 0, max: 50, optional: true }),
  sanitizeString('crNumber',    { min: 0, max: 50, optional: true }),
  sanitizeString('iban',        { min: 0, max: 50, optional: true }),
  sanitizeString('description', { min: 1, max: 2000 }),
  sanitizeString('city',        { min: 1, max: 100 }),
  body('categories').optional().isArray().withMessage('categories must be an array'),
  body('productSamples').optional().isArray().withMessage('productSamples must be an array'),
  body('logoUrl').optional().isString().isLength({ max: 1000 }),
  body('banner').optional().isString().isLength({ max: 1000 }),
  handleValidationErrors,
];

/**
 * Validation for editing an admin-created store
 * (PATCH /api/merchants/admin/stores/:id)
 *
 * Every field is optional — this is a partial update. The controller applies
 * only the keys actually present in the body.
 */
export const validateAdminStoreUpdate = [
  sanitizeString('storeName',   { min: 2, max: 100, optional: true }),
  sanitizeString('ownerName',   { min: 2, max: 100, optional: true }),
  validateEmail('email', true),
  validatePhone('phone', true),
  body('merchantType')
    .optional()
    .isIn(['individual', 'business'])
    .withMessage('merchantType must be "individual" or "business"'),
  sanitizeString('nationalId',  { min: 0, max: 50, optional: true }),
  sanitizeString('crNumber',    { min: 0, max: 50, optional: true }),
  sanitizeString('iban',        { min: 0, max: 50, optional: true }),
  sanitizeString('description', { min: 1, max: 2000, optional: true }),
  sanitizeString('city',        { min: 1, max: 100, optional: true }),
  body('categories').optional().isArray().withMessage('categories must be an array'),
  body('productSamples').optional().isArray().withMessage('productSamples must be an array'),
  body('logoUrl').optional().isString().isLength({ max: 1000 }),
  body('banner').optional().isString().isLength({ max: 1000 }),
  handleValidationErrors,
];

/**
 * Validation for linking an unclaimed store to a registered user
 * (POST /api/merchants/:id/link-user)
 */
export const validateStoreLink = [
  body('clerkUserId')
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('clerkUserId is required'),
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

/**
 * Validation for inviting someone onto a store's team.
 * The role enum is re-stated in merchantTeam.controller.js (ASSIGNABLE_ROLES),
 * which is what actually refuses 'owner' — this is the cheap first pass.
 */
export const validateTeamInvite = [
  validateEmail('email'),
  body('role')
    .isIn(['manager', 'staff'])
    .withMessage('role must be either "manager" or "staff"'),
  handleValidationErrors,
];

/**
 * Validation for changing a member's role.
 */
export const validateTeamRoleUpdate = [
  body('role')
    .isIn(['manager', 'staff'])
    .withMessage('role must be either "manager" or "staff"'),
  handleValidationErrors,
];

/**
 * Validation for handing the store to another member.
 */
export const validateOwnershipTransfer = [
  body('memberId')
    .isMongoId()
    .withMessage('memberId must be a valid member id'),
  handleValidationErrors,
];

/**
 * Validation for accepting an invitation. `merchantId` is optional — it is only
 * needed to disambiguate when someone holds invitations from several stores.
 */
export const validateInviteAccept = [
  body('merchantId')
    .optional()
    .isMongoId()
    .withMessage('merchantId must be a valid store id'),
  handleValidationErrors,
];
