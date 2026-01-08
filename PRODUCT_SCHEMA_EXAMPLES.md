# Product Schema Examples & Usage Guide

## Overview

This document provides practical examples of how to use the improved product schema to create different types of products.

---

## Product Types

### 1. Simple Product (No Variants)

A product with a single price and stock, no attributes or variants.

**Use Case:** Books, digital products, services, or any product that doesn't have variations.

**Example Payload:**
```json
{
  "name": "Introduction to JavaScript",
  "description": "A comprehensive guide to JavaScript programming",
  "category": "507f1f77bcf86cd799439011",
  "price": 29.99,
  "discountPrice": 24.99,
  "stock": 100,
  "images": [
    "https://example.com/images/book-cover.jpg"
  ],
  "isActive": true
}
```

**Key Points:**
- `price` and `stock` are **required** (no variants)
- No `attributes` or `variants` fields needed
- Works exactly like the old system (backward compatible)

---

### 2. Product with Single Attribute

A product with one attribute dimension (e.g., Format, Size, Color only).

**Use Case:** Books with different formats, T-shirts with only sizes.

**Example: Book with Format Attribute**
```json
{
  "name": "Advanced React Patterns",
  "description": "Learn advanced React patterns and techniques",
  "category": "507f1f77bcf86cd799439011",
  "images": [
    "https://example.com/images/react-book.jpg"
  ],
  "attributes": [
    {
      "name": "format",
      "displayName": "Format",
      "type": "select",
      "required": true,
      "options": ["Hardcover", "Paperback", "eBook"]
    }
  ],
  "variants": [
    {
      "sku": "REACT-BOOK-HC",
      "attributes": {
        "format": "Hardcover"
      },
      "price": 49.99,
      "discountPrice": 39.99,
      "stock": 50,
      "isActive": true
    },
    {
      "sku": "REACT-BOOK-PB",
      "attributes": {
        "format": "Paperback"
      },
      "price": 29.99,
      "discountPrice": 24.99,
      "stock": 100,
      "isActive": true
    },
    {
      "sku": "REACT-BOOK-EB",
      "attributes": {
        "format": "eBook"
      },
      "price": 19.99,
      "stock": 999,
      "isActive": true
    }
  ],
  "isActive": true
}
```

**Key Points:**
- `price` and `stock` at product level are **optional** (calculated from variants)
- Each variant has its own `price`, `stock`, and `sku`
- All variants must include all required attributes

---

### 3. Product with Multiple Attributes (Size + Color)

A product with multiple attribute dimensions creating a matrix of variants.

**Use Case:** Clothing, shoes, accessories with size and color combinations.

**Example: T-Shirt with Size and Color**
```json
{
  "name": "Classic Cotton T-Shirt",
  "description": "100% cotton, comfortable fit",
  "category": "507f1f77bcf86cd799439012",
  "images": [
    "https://example.com/images/tshirt-default.jpg"
  ],
  "attributes": [
    {
      "name": "size",
      "displayName": "Size",
      "type": "select",
      "required": true,
      "options": ["S", "M", "L", "XL", "XXL"]
    },
    {
      "name": "color",
      "displayName": "Color",
      "type": "select",
      "required": true,
      "options": ["Red", "Blue", "Black", "White"]
    }
  ],
  "variants": [
    {
      "sku": "TSHIRT-RED-S",
      "attributes": {
        "size": "S",
        "color": "Red"
      },
      "price": 19.99,
      "stock": 25,
      "images": [
        "https://example.com/images/tshirt-red-s.jpg"
      ],
      "isActive": true
    },
    {
      "sku": "TSHIRT-RED-M",
      "attributes": {
        "size": "M",
        "color": "Red"
      },
      "price": 19.99,
      "stock": 30,
      "images": [
        "https://example.com/images/tshirt-red-m.jpg"
      ],
      "isActive": true
    },
    {
      "sku": "TSHIRT-RED-L",
      "attributes": {
        "size": "L",
        "color": "Red"
      },
      "price": 21.99,
      "stock": 20,
      "isActive": true
    },
    {
      "sku": "TSHIRT-BLUE-S",
      "attributes": {
        "size": "S",
        "color": "Blue"
      },
      "price": 19.99,
      "stock": 15,
      "isActive": true
    },
    {
      "sku": "TSHIRT-BLUE-M",
      "attributes": {
        "size": "M",
        "color": "Blue"
      },
      "price": 19.99,
      "stock": 25,
      "isActive": true
    },
    {
      "sku": "TSHIRT-BLUE-L",
      "attributes": {
        "size": "L",
        "color": "Blue"
      },
      "price": 21.99,
      "stock": 18,
      "isActive": true
    },
    {
      "sku": "TSHIRT-BLACK-S",
      "attributes": {
        "size": "S",
        "color": "Black"
      },
      "price": 19.99,
      "stock": 20,
      "isActive": true
    },
    {
      "sku": "TSHIRT-BLACK-M",
      "attributes": {
        "size": "M",
        "color": "Black"
      },
      "price": 19.99,
      "stock": 35,
      "isActive": true
    },
    {
      "sku": "TSHIRT-BLACK-L",
      "attributes": {
        "size": "L",
        "color": "Black"
      },
      "price": 21.99,
      "stock": 22,
      "isActive": true
    },
    {
      "sku": "TSHIRT-WHITE-S",
      "attributes": {
        "size": "S",
        "color": "White"
      },
      "price": 19.99,
      "stock": 10,
      "isActive": true
    },
    {
      "sku": "TSHIRT-WHITE-M",
      "attributes": {
        "size": "M",
        "color": "White"
      },
      "price": 19.99,
      "stock": 15,
      "isActive": true
    },
    {
      "sku": "TSHIRT-WHITE-L",
      "attributes": {
        "size": "L",
        "color": "White"
      },
      "price": 21.99,
      "stock": 12,
      "isActive": true
    }
  ],
  "isActive": true
}
```

**Key Points:**
- Creates 5 sizes × 4 colors = 20 possible variants (only active ones included)
- Each variant can have different prices (e.g., L and XL cost more)
- Each variant has its own stock
- Variants can have variant-specific images

---

### 4. Product with Custom Attributes (Non-Clothing)

A product with custom attributes that aren't size/color.

**Use Case:** Electronics, furniture, appliances.

**Example: Laptop with Storage, RAM, and Warranty**
```json
{
  "name": "Pro Laptop 15\"",
  "description": "High-performance laptop for professionals",
  "category": "507f1f77bcf86cd799439013",
  "images": [
    "https://example.com/images/laptop-default.jpg"
  ],
  "attributes": [
    {
      "name": "storage",
      "displayName": "Storage",
      "type": "select",
      "required": true,
      "options": ["256GB", "512GB", "1TB"]
    },
    {
      "name": "ram",
      "displayName": "RAM",
      "type": "select",
      "required": true,
      "options": ["8GB", "16GB", "32GB"]
    },
    {
      "name": "warranty",
      "displayName": "Warranty Period",
      "type": "select",
      "required": false,
      "options": ["1 Year", "2 Years", "3 Years"]
    }
  ],
  "variants": [
    {
      "sku": "LAPTOP-256-8GB",
      "attributes": {
        "storage": "256GB",
        "ram": "8GB",
        "warranty": "1 Year"
      },
      "price": 999.99,
      "stock": 10,
      "isActive": true
    },
    {
      "sku": "LAPTOP-512-16GB",
      "attributes": {
        "storage": "512GB",
        "ram": "16GB",
        "warranty": "2 Years"
      },
      "price": 1299.99,
      "stock": 5,
      "isActive": true
    },
    {
      "sku": "LAPTOP-1TB-32GB",
      "attributes": {
        "storage": "1TB",
        "ram": "32GB",
        "warranty": "3 Years"
      },
      "price": 1999.99,
      "stock": 3,
      "isActive": true
    }
  ],
  "isActive": true
}
```

**Key Points:**
- Attributes can be any name (not limited to size/color)
- Optional attributes (warranty) don't need to be in every variant
- Prices can vary significantly based on attributes

---

### 5. Product with Text/Number Attributes

A product with free-form text or number attributes.

**Use Case:** Custom products, personalized items, products with measurements.

**Example: Custom Engraved Item**
```json
{
  "name": "Custom Engraved Watch",
  "description": "Personalized watch with custom engraving",
  "category": "507f1f77bcf86cd799439014",
  "images": [
    "https://example.com/images/watch-default.jpg"
  ],
  "attributes": [
    {
      "name": "material",
      "displayName": "Material",
      "type": "select",
      "required": true,
      "options": ["Stainless Steel", "Gold", "Silver"]
    },
    {
      "name": "engraving",
      "displayName": "Custom Engraving Text",
      "type": "text",
      "required": false,
      "options": []
    },
    {
      "name": "band_length",
      "displayName": "Band Length (cm)",
      "type": "number",
      "required": true,
      "options": []
    }
  ],
  "variants": [
    {
      "sku": "WATCH-SS-18",
      "attributes": {
        "material": "Stainless Steel",
        "band_length": "18"
      },
      "price": 299.99,
      "stock": 5,
      "isActive": true
    },
    {
      "sku": "WATCH-GOLD-20",
      "attributes": {
        "material": "Gold",
        "band_length": "20"
      },
      "price": 599.99,
      "stock": 2,
      "isActive": true
    }
  ],
  "isActive": true
}
```

**Key Points:**
- Text and number attributes allow free-form input
- Still need to create variants for each combination
- For truly custom products, you might want a separate "custom product" flow

---

## Validation Rules

### Required Fields (All Products)
- `name` (string, 2-200 chars)
- `description` (string, 1-5000 chars)
- `category` (MongoDB ObjectId)
- `images` (array, 1-10 URLs)

### Simple Products (No Variants)
- `price` (number, ≥ 0.01) - **Required**
- `stock` (integer, ≥ 0) - **Required**

### Variant-Based Products
- `attributes` (array) - **Required if variants exist**
- `variants` (array, ≥ 1 variant) - **Required if attributes exist**
- `price` and `stock` at product level - **Optional** (calculated from variants)

### Variant Requirements
- `sku` (string, unique within product) - **Required**
- `attributes` (object matching attribute definitions) - **Required**
- `price` (number, ≥ 0.01) - **Required**
- `stock` (integer, ≥ 0) - **Required**
- `isActive` (boolean) - Optional, defaults to true

### Attribute Requirements
- `name` (string) - **Required**, must be unique within product
- `displayName` (string) - **Required**
- `type` (enum: 'select', 'text', 'number') - **Required**
- `required` (boolean) - Optional, defaults to false
- `options` (array) - **Required if type is 'select'**

---

## Backward Compatibility

### Legacy Products
Existing products without variants continue to work:
- They have `price` and `stock` at product level
- They may have `sizes` and `colors` arrays
- They work exactly as before

### Auto-Population
When a product with variants is saved:
- `sizes` array is auto-populated from variant attributes (if "size" attribute exists)
- `colors` array is auto-populated from variant attributes (if "color" attribute exists)
- `stock` at product level is set to sum of all variant stocks

### Migration Path
1. Keep existing products as-is (no breaking changes)
2. New products can use variant system
3. Gradually migrate existing products to variants when needed
4. Legacy fields (`sizes`, `colors`) remain for backward compatibility

---

## API Endpoints

### Create Product
```
POST /api/products
Authorization: Bearer <token>
Content-Type: application/json

Body: (See examples above)
```

### Update Product
```
PUT /api/products/:id
Authorization: Bearer <token>
Content-Type: application/json

Body: (Partial update - only include fields to update)
```

### Get Product
```
GET /api/products/:id

Response includes full product with variants
```

---

## Best Practices

1. **SKU Naming:** Use consistent, descriptive SKUs (e.g., "PRODUCT-ATTR1-ATTR2")
2. **Variant Images:** Provide variant-specific images when attributes affect appearance (e.g., color)
3. **Stock Management:** Keep variant stocks updated for accurate inventory
4. **Attribute Names:** Use lowercase, no spaces (e.g., "band_length" not "Band Length")
5. **Display Names:** Use user-friendly names (e.g., "Band Length" not "band_length")
6. **Required Attributes:** Only mark attributes as required if they're truly necessary
7. **Price Consistency:** Consider if all variants should have the same price or different prices

---

## Common Patterns

### Pattern 1: Clothing (Size + Color)
- Attributes: `size`, `color`
- Variants: All combinations
- Prices: May vary by size (larger = more expensive)

### Pattern 2: Electronics (Specifications)
- Attributes: `storage`, `ram`, `color`
- Variants: Selected combinations (not all combinations available)
- Prices: Vary significantly by specifications

### Pattern 3: Books (Format Only)
- Attributes: `format`
- Variants: Hardcover, Paperback, eBook
- Prices: eBook < Paperback < Hardcover

### Pattern 4: Simple Products
- No attributes, no variants
- Single price and stock
- Simplest form

---

## Error Handling

### Common Errors

1. **Missing Required Fields:**
   ```json
   {
     "error": "Price is required for products without variants"
   }
   ```

2. **Duplicate SKU:**
   ```json
   {
     "error": "Duplicate SKU found: TSHIRT-RED-M"
   }
   ```

3. **Missing Required Attribute:**
   ```json
   {
     "error": "Variant missing required attribute: Size"
   }
   ```

4. **Invalid Attribute Value:**
   ```json
   {
     "error": "Variant attribute \"size\" value \"XXXL\" is not in allowed options"
   }
   ```

---

## Testing Examples

### Test Case 1: Create Simple Product
```bash
curl -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Product",
    "description": "A simple test product",
    "category": "507f1f77bcf86cd799439011",
    "price": 10.99,
    "stock": 50,
    "images": ["https://example.com/image.jpg"]
  }'
```

### Test Case 2: Create Product with Variants
```bash
curl -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test T-Shirt",
    "description": "A test t-shirt",
    "category": "507f1f77bcf86cd799439011",
    "images": ["https://example.com/image.jpg"],
    "attributes": [
      {
        "name": "size",
        "displayName": "Size",
        "type": "select",
        "required": true,
        "options": ["S", "M", "L"]
      }
    ],
    "variants": [
      {
        "sku": "TEST-S",
        "attributes": {"size": "S"},
        "price": 19.99,
        "stock": 10,
        "isActive": true
      },
      {
        "sku": "TEST-M",
        "attributes": {"size": "M"},
        "price": 19.99,
        "stock": 15,
        "isActive": true
      }
    ]
  }'
```

---

## Summary

The improved product schema supports:
- ✅ Simple products (backward compatible)
- ✅ Products with single attribute
- ✅ Products with multiple attributes
- ✅ Custom attributes (not limited to size/color)
- ✅ Variant-level pricing
- ✅ Variant-level stock
- ✅ Variant-specific images
- ✅ SKU management
- ✅ Backward compatibility with existing products
