/**
 * Cart Utility Functions
 * Provides reusable functions for cart operations, attribute handling, and validation
 */

/**
 * Normalizes attribute values to ensure consistency
 * Handles null, undefined, empty strings, and string "null"/"undefined"
 * 
 * @param {any} value - The attribute value to normalize
 * @returns {string} - Normalized string value (empty string if invalid)
 */
function normalizeAttributeValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value).trim();
  const lowerValue = stringValue.toLowerCase();
  if (lowerValue === 'null' || lowerValue === 'undefined' || lowerValue === '') {
    return '';
  }
  return stringValue;
}

/**
 * Normalizes an attributes object by normalizing all values
 * 
 * @param {Object} attributes - Object with attribute key-value pairs
 * @returns {Object} - Normalized attributes object
 */
function normalizeAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') {
    return {};
  }
  
  const normalized = {};
  for (const [key, value] of Object.entries(attributes)) {
    const normalizedValue = normalizeAttributeValue(value);
    // Only include non-empty attributes
    if (normalizedValue !== '') {
      normalized[key] = normalizedValue;
    }
  }
  return normalized;
}

/**
 * Converts legacy size field to attributes format
 * Maintains backward compatibility
 * 
 * @param {string} size - Legacy size value
 * @returns {Object} - Attributes object with size key
 */
function sizeToAttributes(size) {
  const normalizedSize = normalizeAttributeValue(size);
  if (normalizedSize === '') {
    return {};
  }
  return { size: normalizedSize };
}

/**
 * Merges legacy size with new attributes
 * If size is provided and attributes.size is not set, adds size to attributes
 * 
 * @param {string} size - Legacy size value
 * @param {Object} attributes - New attributes object
 * @returns {Object} - Merged attributes object
 */
function mergeSizeAndAttributes(size, attributes) {
  const normalizedAttrs = normalizeAttributes(attributes || {});
  const normalizedSize = normalizeAttributeValue(size);
  
  // If size is provided and not already in attributes, add it
  if (normalizedSize !== '' && !normalizedAttrs.size) {
    normalizedAttrs.size = normalizedSize;
  }
  
  return normalizedAttrs;
}

/**
 * Generates a unique key for a cart item based on product ID and attributes
 * Used to identify if two cart items are the same (same product + same attributes)
 * 
 * @param {string} productId - Product ObjectId as string
 * @param {Object} attributes - Attributes object
 * @returns {string} - Unique cart item key
 */
function generateCartItemKey(productId, attributes) {
  if (!productId) {
    throw new Error('Product ID is required');
  }
  
  const normalizedAttrs = normalizeAttributes(attributes || {});
  
  // Sort attribute keys for consistent hashing
  const sortedKeys = Object.keys(normalizedAttrs).sort();
  
  // Create a string representation: "key1:value1|key2:value2|..."
  const attrString = sortedKeys
    .map(key => `${key}:${normalizedAttrs[key]}`)
    .join('|');
  
  // Return key in format: "productId|attr1:val1|attr2:val2"
  return attrString ? `${productId}|${attrString}` : productId;
}

/**
 * Compares two attribute objects to determine if they represent the same variant
 * 
 * @param {Object} attrs1 - First attributes object
 * @param {Object} attrs2 - Second attributes object
 * @returns {boolean} - True if attributes are equivalent
 */
function areAttributesEqual(attrs1, attrs2) {
  const normalized1 = normalizeAttributes(attrs1 || {});
  const normalized2 = normalizeAttributes(attrs2 || {});
  
  const keys1 = Object.keys(normalized1).sort();
  const keys2 = Object.keys(normalized2).sort();
  
  if (keys1.length !== keys2.length) {
    return false;
  }
  
  return keys1.every(key => normalized1[key] === normalized2[key]);
}

/**
 * Validates that required attributes are present
 * 
 * @param {Array} productAttributes - Product's attribute definitions
 * @param {Object} selectedAttributes - User-selected attributes
 * @returns {{valid: boolean, missing: string[]}} - Validation result
 */
function validateRequiredAttributes(productAttributes, selectedAttributes) {
  if (!productAttributes || !Array.isArray(productAttributes)) {
    return { valid: true, missing: [] };
  }
  
  const normalizedSelected = normalizeAttributes(selectedAttributes || {});
  const required = productAttributes.filter(attr => attr.required === true);
  const missing = required.filter(
    attr => !normalizedSelected[attr.name] || normalizedSelected[attr.name].trim() === ''
  );
  
  return {
    valid: missing.length === 0,
    missing: missing.map(attr => attr.displayName || attr.name)
  };
}

/**
 * Converts Mongoose Map to plain object
 * 
 * @param {Map} map - Mongoose Map object
 * @returns {Object} - Plain JavaScript object
 */
function mapToObject(map) {
  if (!map || !(map instanceof Map)) {
    return {};
  }
  
  const obj = {};
  for (const [key, value] of map.entries()) {
    obj[key] = value;
  }
  return obj;
}

/**
 * Converts plain object to Mongoose Map
 * 
 * @param {Object} obj - Plain JavaScript object
 * @returns {Map} - Mongoose Map object
 */
function objectToMap(obj) {
  if (!obj || typeof obj !== 'object') {
    return new Map();
  }
  
  const map = new Map();
  for (const [key, value] of Object.entries(obj)) {
    map.set(key, String(value));
  }
  return map;
}

/**
 * Finds a matching variant for a product based on attributes
 * 
 * @param {Object} product - Product document with variants
 * @param {Object} attributes - Selected attributes to match
 * @returns {Object|null} - Matching variant or null
 */
function findMatchingVariant(product, attributes) {
  if (!product || !product.variants || !Array.isArray(product.variants) || product.variants.length === 0) {
    return null;
  }
  
  const normalizedAttrs = normalizeAttributes(attributes || {});
  
  // Find variant where all attributes match
  return product.variants.find(variant => {
    if (!variant.isActive) return false;
    
    const variantAttrs = variant.attributes instanceof Map 
      ? Object.fromEntries(variant.attributes)
      : (variant.attributes || {});
    
    // Check if all provided attributes match the variant
    const providedKeys = Object.keys(normalizedAttrs);
    if (providedKeys.length === 0) return false;
    
    return providedKeys.every(key => {
      return variantAttrs[key] === normalizedAttrs[key];
    });
  }) || null;
}

/**
 * Gets the final selling price for a product
 * SMART PRICING SYSTEM: Uses finalPrice > discountPrice > price
 * 
 * @param {Object} product - Product document
 * @param {Object} attributes - Selected attributes (optional)
 * @returns {number} - Final price to use (finalPrice if available, else discountPrice, else price)
 */
function getProductPrice(product, attributes = null) {
  if (!product) {
    return 0;
  }
  
  // If attributes provided and product has variants, try to find matching variant
  if (attributes && product.variants && product.variants.length > 0) {
    const variant = findMatchingVariant(product, attributes);
    if (variant) {
      // Variant: prefer finalPrice (smart pricing), fallback to discountPrice, then price
      if (variant.finalPrice && variant.finalPrice > 0) {
        return variant.finalPrice;
      }
      if (variant.discountPrice && variant.discountPrice > 0) {
        return variant.discountPrice;
      }
      if (variant.price) {
        return variant.price;
      }
    }
  }
  
  // Product: prefer finalPrice (smart pricing), fallback to discountPrice, then price
  if (product.finalPrice && product.finalPrice > 0) {
    return product.finalPrice;
  }
  if (product.discountPrice && product.discountPrice > 0) {
    return product.discountPrice;
  }
  return product.price || 0;
}

export {
  normalizeAttributeValue,
  normalizeAttributes,
  sizeToAttributes,
  mergeSizeAndAttributes,
  generateCartItemKey,
  areAttributesEqual,
  validateRequiredAttributes,
  mapToObject,
  objectToMap,
  findMatchingVariant,
  getProductPrice,
};
