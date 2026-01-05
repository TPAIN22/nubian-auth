/**
 * Standardized response utility
 * Provides consistent response format across all API endpoints
 */

/**
 * Standard success response format
 * @param {Object} res - Express response object
 * @param {Object} options - Response options
 * @param {*} options.data - Response data
 * @param {string} options.message - Success message
 * @param {number} options.statusCode - HTTP status code (default: 200)
 * @param {Object} options.meta - Additional metadata (pagination, etc.)
 */
export const sendSuccess = (res, { data = null, message = 'Success', statusCode = 200, meta = null } = {}) => {
  const response = {
    success: true,
    message,
    ...(data !== null && { data }),
    ...(meta && { meta }),
    requestId: res.req?.requestId || 'unknown',
    timestamp: new Date().toISOString(),
  };

  return res.status(statusCode).json(response);
};

/**
 * Standard error response format
 * @param {Object} res - Express response object
 * @param {Object} options - Error options
 * @param {string} options.message - Error message
 * @param {string} options.code - Error code
 * @param {number} options.statusCode - HTTP status code (default: 500)
 * @param {*} options.details - Error details (validation errors, etc.)
 */
export const sendError = (res, { message = 'An error occurred', code = 'ERROR', statusCode = 500, details = null } = {}) => {
  const response = {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
      requestId: res.req?.requestId || 'unknown',
    },
    timestamp: new Date().toISOString(),
  };

  return res.status(statusCode).json(response);
};

/**
 * Standard paginated response format
 * @param {Object} res - Express response object
 * @param {Object} options - Pagination options
 * @param {Array} options.data - Response data array
 * @param {number} options.page - Current page
 * @param {number} options.limit - Items per page
 * @param {number} options.total - Total items
 * @param {string} options.message - Success message
 */
export const sendPaginated = (res, { data = [], page = 1, limit = 10, total = 0, message = 'Success' } = {}) => {
  const totalPages = Math.ceil(total / limit);
  
  return sendSuccess(res, {
    data,
    message,
    meta: {
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    },
  });
};

/**
 * Standard validation error response
 * @param {Object} res - Express response object
 * @param {Array} options.errors - Validation errors array
 * @param {string} options.message - Error message
 */
export const sendValidationError = (res, { errors = [], message = 'Validation failed' } = {}) => {
  return sendError(res, {
    message,
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    details: errors,
  });
};

/**
 * Standard not found response
 * @param {Object} res - Express response object
 * @param {string} resource - Resource name (e.g., "Product", "Order")
 */
export const sendNotFound = (res, resource = 'Resource') => {
  return sendError(res, {
    message: `${resource} not found`,
    code: 'NOT_FOUND',
    statusCode: 404,
  });
};

/**
 * Standard unauthorized response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 */
export const sendUnauthorized = (res, message = 'Authentication required') => {
  return sendError(res, {
    message,
    code: 'UNAUTHORIZED',
    statusCode: 401,
  });
};

/**
 * Standard forbidden response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 */
export const sendForbidden = (res, message = 'Access forbidden') => {
  return sendError(res, {
    message,
    code: 'FORBIDDEN',
    statusCode: 403,
  });
};

/**
 * Standard created response (201)
 * @param {Object} res - Express response object
 * @param {*} data - Created resource data
 * @param {string} message - Success message
 */
export const sendCreated = (res, data, message = 'Resource created successfully') => {
  return sendSuccess(res, {
    data,
    message,
    statusCode: 201,
  });
};

/**
 * Standard no content response (204)
 * @param {Object} res - Express response object
 */
export const sendNoContent = (res) => {
  return res.status(204).send();
};

