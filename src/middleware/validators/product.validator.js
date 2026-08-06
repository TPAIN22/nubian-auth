import { body } from 'express-validator';
import {
  sanitizeString,
  validateNumber,
  validateInteger,
  validateArray,
  validateURL,
  validateBoolean,
  validateEnum,
  handleValidationErrors,
} from '../validation.middleware.js';

// Validates an images array: 1–10 items, all must be https:// URLs
const buildImagesValidator = (optional = false) => {
  let v = body('images');
  if (optional) v = v.optional();
  return v.custom((value) => {
    if (!Array.isArray(value)) throw new Error('images must be an array');
    if (value.length < 1 || value.length > 10) throw new Error('images must contain between 1 and 10 items');
    for (const url of value) {
      if (typeof url !== 'string' || !url.startsWith('https://')) {
        throw new Error('Each image must be a valid HTTPS URL');
      }
    }
    return true;
  });
};
const validateImagesArray         = buildImagesValidator(false); // required on create
const validateImagesArrayOptional = buildImagesValidator(true);  // optional on update

// Custom validator for attributes array
const validateAttributes = body('attributes')
  .optional()
  .isArray()
  .withMessage('attributes must be an array')
  .custom((attributes) => {
    if (!Array.isArray(attributes)) return true;
    
    for (const attr of attributes) {
      if (!attr.name || typeof attr.name !== 'string' || attr.name.trim().length === 0) {
        throw new Error('Each attribute must have a non-empty name');
      }
      // Relaxed requirements for wizard compatibility
      if (attr.type && !['select', 'text', 'number'].includes(attr.type)) {
        throw new Error('Attribute type must be one of: select, text, number');
      }
    }
    return true;
  });

// Custom validator for variants array
const validateVariants = body('variants')
  .optional()
  .isArray()
  .withMessage('variants must be an array')
  .custom((variants, { req }) => {
    if (!Array.isArray(variants)) return true;
    
    if (variants.length === 0) {
      throw new Error('If variants array is provided, it must contain at least one variant');
    }
    
    const skus = new Set();
    const attributes = req.body.attributes || [];
    
    for (const variant of variants) {
      if (!variant.sku || typeof variant.sku !== 'string' || variant.sku.trim().length === 0) {
        throw new Error('Each variant must have a non-empty SKU');
      }
      
      if (skus.has(variant.sku.trim().toUpperCase())) {
        throw new Error(`Duplicate SKU found: ${variant.sku}`);
      }
      skus.add(variant.sku.trim().toUpperCase());
      
      if (!variant.attributes || typeof variant.attributes !== 'object') {
        throw new Error('Each variant must have an attributes object');
      }
      
      // Validate merchantPrice (formerly price)
      if (typeof variant.merchantPrice !== 'number' || variant.merchantPrice < 0.01) {
        throw new Error('Each variant must have a merchantPrice greater than 0');
      }
      
      if (typeof variant.stock !== 'number' || variant.stock < 0 || !Number.isInteger(variant.stock)) {
        throw new Error('Each variant must have a non-negative integer stock value');
      }

      // Absolute per-variant discount (currency amount, not a percentage).
      // Optional — schema default is 0.
      if (variant.merchantDiscount !== undefined && variant.merchantDiscount !== null) {
        const md = Number(variant.merchantDiscount);
        if (!Number.isFinite(md) || md < 0) {
          throw new Error('Each variant merchantDiscount must be a number >= 0');
        }
      }
    }

    return true;
  });

// Custom validator for the product-level discount block (product.model.js:58).
// Optional object: { type: 'percentage'|'fixed'|null, value >= 0,
// maxDiscount? >= 0, startsAt?/endsAt? ISO dates, isActive? boolean }.
// The controller's sanitizeDiscountInput does the coercion — this only rejects
// input that is structurally wrong so a bad payload fails loudly.
const validateDiscountBlock = body('discount')
  .optional({ nullable: true })
  .custom((discount) => {
    if (discount === null) return true; // explicit "no discount"
    if (typeof discount !== 'object' || Array.isArray(discount)) {
      throw new Error('discount must be an object');
    }

    const { type, value, maxDiscount, startsAt, endsAt, isActive } = discount;

    if (type !== undefined && type !== null && type !== 'percentage' && type !== 'fixed') {
      throw new Error('discount.type must be one of: percentage, fixed, null');
    }

    if (value !== undefined && value !== null) {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0) {
        throw new Error('discount.value must be a number >= 0');
      }
      if (type === 'percentage' && v > 100) {
        throw new Error('discount.value must be <= 100 when discount.type is percentage');
      }
    }

    if (maxDiscount !== undefined && maxDiscount !== null) {
      const m = Number(maxDiscount);
      if (!Number.isFinite(m) || m < 0) {
        throw new Error('discount.maxDiscount must be a number >= 0');
      }
    }

    for (const [field, raw] of [['startsAt', startsAt], ['endsAt', endsAt]]) {
      if (raw === undefined || raw === null) continue;
      const d = new Date(raw);
      if (isNaN(d.getTime())) {
        throw new Error(`discount.${field} must be a valid ISO date`);
      }
    }

    if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
      throw new Error('discount.startsAt must be before discount.endsAt');
    }

    if (isActive !== undefined && typeof isActive !== 'boolean') {
      throw new Error('discount.isActive must be a boolean');
    }

    return true;
  });

// Custom validator to ensure pricing is provided
const validatePricingForSimpleProduct = body()
  .custom((value, { req }) => {
    const hasVariants = req.body.variants && Array.isArray(req.body.variants) && req.body.variants.length > 0;
    
    if (hasVariants) return true;
    
    // Fallback check for old simple product format
    if (req.body.merchantPrice === undefined && req.body.price === undefined) {
      throw new Error('Price (merchantPrice) is required');
    }
    if (req.body.stock === undefined) {
      throw new Error('Stock is required');
    }
    
    return true;
  });

/**
 * Validation for product creation
 */
export const validateProductCreate = [
  sanitizeString('name', { min: 2, max: 200 }),
  sanitizeString('description', { min: 1, max: 5000 }), // Required by model, not optional
  
  // Price and stock are conditionally required (required if no variants, optional if variants exist)
  validateNumber('price', { min: 0.01, max: 1000000, optional: true }),
  validateInteger('stock', { min: 0, max: 100000, optional: true }),

  // Product-level discount block (replaces the dead `discountPrice` field,
  // which has never existed in the schema). See Issue #24.
  validateDiscountBlock,

  // Use custom validator for images to avoid conflicts between array and item validation
  validateImagesArray,
  
  // Legacy sizes field - no longer restricted to enum
  validateArray('sizes', { min: 0, max: 20, optional: true }),
  body('sizes.*')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 1, max: 50 })
    .withMessage('Each size must be between 1 and 50 characters'),
  
  // Legacy colors field
  validateArray('colors', { min: 0, max: 20, optional: true }),
  body('colors.*')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 1, max: 50 })
    .withMessage('Each color must be between 1 and 50 characters'),
  
  // New flexible attributes system
  validateAttributes,
  
  // Variants validation
  validateVariants,
  
  // Ensure price/stock are provided for simple products
  validatePricingForSimpleProduct,
  
  body('category')
    .notEmpty()
    .withMessage('Category is required')
    .isMongoId()
    .withMessage('Category must be a valid MongoDB ID'),
  validateBoolean('isActive', true), // true = optional
  handleValidationErrors,
];

/**
 * Validation for product update
 */
export const validateProductUpdate = [
  sanitizeString('name', { min: 2, max: 200, optional: true }),
  sanitizeString('description', { min: 0, max: 5000, optional: true }),
  validateNumber('price', { min: 0, max: 1000000, optional: true }),
  validateInteger('stock', { min: 0, max: 100000, optional: true }),
  // Product-level discount block — see Issue #24.
  validateDiscountBlock,
  // Images are optional on update — a patch to name/description shouldn't require re-uploading all images
  validateImagesArrayOptional,
  validateArray('sizes', { min: 0, max: 20, optional: true }),
  body('sizes.*')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 1, max: 50 })
    .withMessage('Each size must be between 1 and 50 characters'),
  validateArray('colors', { min: 0, max: 20, optional: true }),
  body('colors.*')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 1, max: 50 })
    .withMessage('Each color must be between 1 and 50 characters'),
  validateAttributes,
  validateVariants,
  body('category')
    .optional()
    .isMongoId()
    .withMessage('Category must be a valid MongoDB ID'),
  validateBoolean('isActive', true),
  handleValidationErrors,
];

