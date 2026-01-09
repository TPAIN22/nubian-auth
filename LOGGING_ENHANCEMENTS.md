# Structured Logging Enhancements for Clerk Auth & Admin Product Routes

## ✅ COMPLETED

### 1. Auth Middleware (`src/middleware/auth.middleware.js`)
**Enhanced `isAdmin` middleware with comprehensive logging:**
- ✅ Entry logging with request context (method, URL, IP, userAgent)
- ✅ Clerk API call logging (before/after)
- ✅ Detailed error handling for Clerk API failures
- ✅ Admin role validation logging
- ✅ Unauthorized access attempt logging with user details
- ✅ Duration tracking for performance monitoring
- ✅ Success logging with user context

## 🔄 ENHANCEMENTS NEEDED

### 2. Admin Product Controller (`src/controllers/products.controller.js`)

#### **Function: `getAllProductsAdmin`**
**Add at function start:**
```javascript
const startTime = Date.now();
const { userId } = getAuth(req);

logger.info('Admin product list request started', {
    requestId: req.requestId,
    userId: userId,
    method: req.method,
    url: req.url,
    query: req.query,
    ip: req.ip || req.connection?.remoteAddress,
});
```

**After filter building, add:**
```javascript
logger.debug('Executing product query', {
    requestId: req.requestId,
    filter: JSON.stringify(filter),
    sort: JSON.stringify(sort),
    skip: skip,
    limit: limit,
});
```

**Before query execution:**
```javascript
const queryStartTime = Date.now();
```

**After query execution:**
```javascript
const queryDuration = Date.now() - queryStartTime;

logger.info('Admin product list query completed', {
    requestId: req.requestId,
    userId: userId,
    totalProducts: totalProducts,
    returnedCount: products.length,
    page: page,
    limit: limit,
    filters: { category, merchant, isActive, includeDeleted, search },
    sortBy: sortField,
    sortOrder: sortOrder,
    queryDurationMs: queryDuration,
    durationMs: Date.now() - startTime,
});
```

**Enhance error logging:**
```javascript
logger.error('Error in getAllProductsAdmin', {
    requestId: req.requestId,
    userId: userId,
    error: error.message,
    errorName: error.name,
    errorCode: error.code,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    query: req.query,
    durationMs: Date.now() - startTime,
});
```

#### **Function: `toggleProductActive`**
**Add at function start:**
```javascript
const startTime = Date.now();
const { userId } = getAuth(req);
const { id } = req.params;
const { isActive } = req.body;

logger.info('Admin toggle product active status request started', {
    requestId: req.requestId,
    userId: userId,
    productId: id,
    requestedIsActive: isActive,
    isActiveType: typeof isActive,
    method: req.method,
    url: req.url,
    ip: req.ip || req.connection?.remoteAddress,
});
```

**Enhance validation error:**
```javascript
if (typeof isActive !== 'boolean') {
    logger.warn('Invalid isActive value provided', {
        requestId: req.requestId,
        userId: userId,
        productId: id,
        providedValue: isActive,
        providedType: typeof isActive,
        durationMs: Date.now() - startTime,
    });
    // ... rest of error handling
}
```

**Before product query:**
```javascript
logger.debug('Querying product for toggle', {
    requestId: req.requestId,
    productId: id,
    userId: userId,
});
```

**Enhance not found logging:**
```javascript
if (!product) {
    logger.warn('Product not found for toggle active status', {
        requestId: req.requestId,
        userId: userId,
        productId: id,
        reason: 'Product not found or is soft-deleted',
        durationMs: Date.now() - startTime,
    });
    // ... rest of error handling
}
```

**Before update:**
```javascript
const previousIsActive = product.isActive;

logger.debug('Product found, updating active status', {
    requestId: req.requestId,
    productId: product._id,
    previousIsActive: previousIsActive,
    newIsActive: isActive,
    merchantId: product.merchant?._id?.toString(),
});
```

**Enhance success logging:**
```javascript
logger.info('Product active status toggled by admin', {
    requestId: req.requestId,
    userId: userId,
    productId: product._id.toString(),
    previousIsActive: previousIsActive,
    newIsActive: product.isActive,
    merchantId: product.merchant?._id?.toString(),
    merchantName: product.merchant?.businessName,
    productName: product.name,
    durationMs: Date.now() - startTime,
});
```

**Enhance error logging:**
```javascript
logger.error('Error toggling product active status', {
    requestId: req.requestId,
    userId: userId,
    productId: id,
    requestedIsActive: isActive,
    error: error.message,
    errorName: error.name,
    errorCode: error.code,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    durationMs: Date.now() - startTime,
});
```

#### **Function: `restoreProduct`**
**Add at function start:**
```javascript
const startTime = Date.now();
const { userId } = getAuth(req);
const { id } = req.params;

logger.info('Admin restore product request started', {
    requestId: req.requestId,
    userId: userId,
    productId: id,
    method: req.method,
    url: req.url,
    ip: req.ip || req.connection?.remoteAddress,
});
```

**Add debug logging before query:**
```javascript
logger.debug('Querying for soft-deleted product', {
    requestId: req.requestId,
    productId: id,
    userId: userId,
});
```

**Enhance not found logging:**
```javascript
if (!product) {
    logger.warn('Product not found for restore', {
        requestId: req.requestId,
        userId: userId,
        productId: id,
        reason: 'Product not found or not soft-deleted',
        durationMs: Date.now() - startTime,
    });
    // ... rest of error handling
}
```

**Before restore:**
```javascript
const deletedAt = product.deletedAt;

logger.debug('Soft-deleted product found, restoring', {
    requestId: req.requestId,
    productId: product._id.toString(),
    deletedAt: deletedAt,
    productName: product.name,
    merchantId: product.merchant?.toString(),
});
```

**Enhance success logging:**
```javascript
logger.info('Product restored by admin', {
    requestId: req.requestId,
    userId: userId,
    productId: product._id.toString(),
    productName: product.name,
    merchantId: product.merchant?.toString(),
    wasDeletedAt: deletedAt,
    restoredAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
});
```

**Enhance error logging:**
```javascript
logger.error('Error restoring product', {
    requestId: req.requestId,
    userId: userId,
    productId: id,
    error: error.message,
    errorName: error.name,
    errorCode: error.code,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    durationMs: Date.now() - startTime,
});
```

#### **Function: `hardDeleteProduct`**
**Add at function start:**
```javascript
const startTime = Date.now();
const { userId } = getAuth(req);
const { id } = req.params;

logger.info('Admin hard delete product request started', {
    requestId: req.requestId,
    userId: userId,
    productId: id,
    method: req.method,
    url: req.url,
    ip: req.ip || req.connection?.remoteAddress,
    warning: 'Permanent deletion requested',
});
```

**Add debug logging before query:**
```javascript
logger.debug('Querying product before hard delete', {
    requestId: req.requestId,
    productId: id,
    userId: userId,
});
```

**Enhance not found logging:**
```javascript
if (!product) {
    logger.warn('Product not found for hard delete', {
        requestId: req.requestId,
        userId: userId,
        productId: id,
        reason: 'Product does not exist',
        durationMs: Date.now() - startTime,
    });
    // ... rest of error handling
}
```

**Before deletion - capture full product details:**
```javascript
// Capture product details before deletion for audit trail
const productDetails = {
    productId: product._id.toString(),
    productName: product.name,
    merchantId: product.merchant?.toString(),
    categoryId: product.category?.toString(),
    isActive: product.isActive,
    deletedAt: product.deletedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    price: product.price,
    stock: product.stock,
    hasVariants: product.variants && product.variants.length > 0,
    variantCount: product.variants?.length || 0,
};

// Critical audit log - log before deletion
logger.warn('Product hard deleted by admin - PERMANENT DELETION', {
    requestId: req.requestId,
    userId: userId,
    action: 'HARD_DELETE',
    productDetails: productDetails,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
});
```

**Add debug before deletion:**
```javascript
logger.debug('Executing permanent deletion', {
    requestId: req.requestId,
    productId: id,
    userId: userId,
});
```

**After deletion:**
```javascript
logger.info('Product permanently deleted successfully', {
    requestId: req.requestId,
    userId: userId,
    productId: productDetails.productId,
    productName: productDetails.productName,
    merchantId: productDetails.merchantId,
    durationMs: Date.now() - startTime,
});
```

**Enhance error logging:**
```javascript
logger.error('Error hard deleting product', {
    requestId: req.requestId,
    userId: userId,
    productId: id,
    error: error.message,
    errorName: error.name,
    errorCode: error.code,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    durationMs: Date.now() - startTime,
});
```

---

## 📊 LOGGING STRUCTURE SUMMARY

### All Logs Should Include:
1. **Request Context:**
   - `requestId` - Request correlation ID
   - `userId` - Admin user ID
   - `method` - HTTP method
   - `url` - Full URL
   - `path` - Route path
   - `ip` - Client IP address
   - `userAgent` - Client user agent (where applicable)

2. **Operation Context:**
   - `productId` - Product ID being operated on
   - `action` - Action being performed (e.g., "TOGGLE_ACTIVE", "RESTORE", "HARD_DELETE")
   - Duration tracking (`startTime`, `durationMs`)

3. **Error Context (for errors):**
   - `error.message` - Error message
   - `errorName` - Error type/name
   - `errorCode` - Error code (if available)
   - `stack` - Stack trace (development only)

4. **Success Context:**
   - Previous state (for updates)
   - New state (for updates)
   - Entity details (product name, merchant info, etc.)

### Log Levels:
- **`info`** - Normal operations (entry, success, query completion)
- **`debug`** - Detailed debugging info (query details, intermediate steps)
- **`warn`** - Warning conditions (not found, invalid input, unauthorized)
- **`error`** - Error conditions (exceptions, failures)

---

## 🎯 BENEFITS

1. **Prevent Silent Failures:**
   - All operations logged at entry point
   - All errors logged with full context
   - Validation failures logged as warnings

2. **Audit Trail:**
   - Complete history of admin actions
   - Product state changes tracked
   - Permanent deletions fully logged

3. **Debugging:**
   - Request correlation via `requestId`
   - Duration tracking for performance issues
   - Detailed context for troubleshooting

4. **Security:**
   - Unauthorized access attempts logged
   - Admin actions tracked with user context
   - IP and user agent logged for security analysis

---

## ✅ VERIFICATION

After implementing, verify:
1. ✅ All admin product routes log entry points
2. ✅ All errors are logged (not silent failures)
3. ✅ Request context included in all logs
4. ✅ Duration tracking works correctly
5. ✅ Error details include stack traces (dev only)
6. ✅ Audit trail for destructive operations (hard delete)

---

**Status**: Auth middleware ✅ Complete | Product controllers ⏳ Enhancements documented above
