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

// Custom validator to check if images array has valid URLs
const validateImagesArray = body('images')
  .custom((value) => {
    if (!Array.isArray(value)) {
      throw new Error('images must be an array');
    }
    if (value.length < 1 || value.length > 10) {
      throw new Error('images must contain between 1 and 10 items');
    }
    // Validate each URL
    for (const url of value) {
      if (typeof url !== 'string' || url.trim().length === 0) {
        throw new Error('Each image must be a non-empty string');
      }
      // Basic URL validation (express-validator will do more detailed check)
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('Each image must be a valid URL starting with http:// or https://');
      }
    }
    return true;
  });

// Custom validator for attributes array
const validateAttributes = body('attributes')
  .optional()
  .isArray()
  .withMessage('attributes must be an array')
  .custom((attributes) => {
    if (!Array.isArray(attributes)) return true; // Handled by isArray
    
    for (const attr of attributes) {
      if (!attr.name || typeof attr.name !== 'string' || attr.name.trim().length === 0) {
        throw new Error('Each attribute must have a non-empty name');
      }
      if (!attr.displayName || typeof attr.displayName !== 'string' || attr.displayName.trim().length === 0) {
        throw new Error('Each attribute must have a non-empty displayName');
      }
      if (!['select', 'text', 'number'].includes(attr.type)) {
        throw new Error('Attribute type must be one of: select, text, number');
      }
      if (attr.type === 'select' && (!Array.isArray(attr.options) || attr.options.length === 0)) {
        throw new Error('Select-type attributes must have at least one option');
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
    if (!Array.isArray(variants)) return true; // Handled by isArray
    
    if (variants.length === 0) {
      throw new Error('If variants array is provided, it must contain at least one variant');
    }
    
    const skus = new Set();
    const attributes = req.body.attributes || [];
    const attributeNames = new Set(attributes.map(a => a.name));
    
    for (const variant of variants) {
      // Validate SKU
      if (!variant.sku || typeof variant.sku !== 'string' || variant.sku.trim().length === 0) {
        throw new Error('Each variant must have a non-empty SKU');
      }
      
      // Check SKU uniqueness
      if (skus.has(variant.sku.trim().toUpperCase())) {
        throw new Error(`Duplicate SKU found: ${variant.sku}`);
      }
      skus.add(variant.sku.trim().toUpperCase());
      
      // Validate attributes
      if (!variant.attributes || typeof variant.attributes !== 'object') {
        throw new Error('Each variant must have an attributes object');
      }
      
      // Validate that variant attributes match product attribute definitions
      if (attributes.length > 0) {
        for (const attr of attributes) {
          if (attr.required && !variant.attributes[attr.name]) {
            throw new Error(`Variant missing required attribute: ${attr.displayName || attr.name}`);
          }
          if (variant.attributes[attr.name] && attr.type === 'select') {
            if (!attr.options || !attr.options.includes(variant.attributes[attr.name])) {
              throw new Error(`Variant attribute "${attr.name}" value "${variant.attributes[attr.name]}" is not in allowed options`);
            }
          }
        }
        
        // Check for extra attributes not defined in product
        for (const key in variant.attributes) {
          if (!attributeNames.has(key)) {
            throw new Error(`Variant has attribute "${key}" that is not defined in product attributes`);
          }
        }
      }
      
      // Validate price
      if (typeof variant.price !== 'number' || variant.price < 0.01) {
        throw new Error('Each variant must have a price greater than 0');
      }
      
      // Validate stock
      if (typeof variant.stock !== 'number' || variant.stock < 0 || !Number.isInteger(variant.stock)) {
        throw new Error('Each variant must have a non-negative integer stock value');
      }
      
      // Validate discountPrice if provided
      if (variant.discountPrice !== undefined) {
        if (typeof variant.discountPrice !== 'number' || variant.discountPrice < 0) {
          throw new Error('Variant discountPrice must be a non-negative number');
        }
      }
      
      // Validate variant images if provided
      if (variant.images !== undefined) {
        if (!Array.isArray(variant.images)) {
          throw new Error('Variant images must be an array');
        }
        for (const img of variant.images) {
          if (typeof img !== 'string' || !img.startsWith('http://') && !img.startsWith('https://')) {
            throw new Error('Each variant image must be a valid URL');
          }
        }
      }
    }
    
    return true;
  });

// Custom validator to ensure price/stock are provided when no variants
const validatePriceStockForSimpleProduct = body()
  .custom((value, { req }) => {
    const hasVariants = req.body.variants && Array.isArray(req.body.variants) && req.body.variants.length > 0;
    
    // If product has variants, price and stock are optional (calculated from variants)
    if (hasVariants) {
      return true;
    }
    
    // If product has no variants, price and stock are required
    if (req.body.price === undefined || req.body.price === null) {
      throw new Error('Price is required for products without variants');
    }
    if (req.body.stock === undefined || req.body.stock === null) {
      throw new Error('Stock is required for products without variants');
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
  validateNumber('discountPrice', { min: 0, max: 1000000, optional: true }),
  validateInteger('stock', { min: 0, max: 100000, optional: true }),
  
  // Use custom validator for images to avoid conflicts between array and item validation
  validateImagesArray,
  // Additional URL validation for each image
  body('images.*')
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Each image must be a valid URL'),
  
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
  validatePriceStockForSimpleProduct,
  
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
  validateNumber('discountPrice', { min: 0, max: 1000000, optional: true }),
  validateInteger('stock', { min: 0, max: 100000, optional: true }),
  validateArray('images', { min: 0, max: 10, optional: true }),
  body('images.*')
    .optional()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Each image must be a valid URL'),
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

