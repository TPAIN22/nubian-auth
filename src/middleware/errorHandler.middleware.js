import logger from '../lib/logger.js';
import { sendError } from '../lib/response.js';

/**
 * Centralized error handling middleware
 * Sanitizes error messages and provides consistent error responses
 */
export const errorHandler = (err, req, res, next) => {
  const requestId = req.requestId || 'unknown';
  
  // Log error with request ID and full context
  logger.error('Error occurred', {
    requestId,
    error: {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      name: err.name,
      code: err.code,
      statusCode: err.statusCode || err.status,
    },
    method: req.method,
    url: req.originalUrl || req.url,
    body: process.env.NODE_ENV === 'development' ? req.body : undefined,
    query: req.query,
    params: req.params,
  });
  
  // Default error values
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal server error';
  let code = err.code || 'INTERNAL_ERROR';
  let details = null;
  
  // Handle specific error types
  if (err.name === 'ValidationError' || err.name === 'ValidatorError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation error';
    details = err.details || err.errors || (err.message ? [{ message: err.message }] : null);
  } else if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'UNAUTHORIZED';
    message = 'Authentication required';
  } else if (err.name === 'ForbiddenError') {
    statusCode = 403;
    code = 'FORBIDDEN';
    message = 'Access forbidden';
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
    code = 'NOT_FOUND';
    message = 'Resource not found';
  } else if (err.name === 'MongoError' || err.name === 'MongooseError') {
    statusCode = 503;
    code = 'DATABASE_ERROR';
    message = 'Database error occurred';
    // Don't expose database error details in production
    if (process.env.NODE_ENV !== 'development') {
      message = 'Database temporarily unavailable';
      details = null;
    } else {
      details = { mongoError: err.message };
    }
  } else if (err.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_ID';
    message = 'Invalid ID format';
    details = process.env.NODE_ENV === 'development' ? { path: err.path, value: err.value } : null;
  } else if (err.name === 'MongoServerError') {
    // Handle MongoDB duplicate key errors
    if (err.code === 11000) {
      statusCode = 409;
      code = 'DUPLICATE_ENTRY';
      message = 'Resource already exists';
      details = process.env.NODE_ENV === 'development' ? { duplicateField: Object.keys(err.keyPattern || {}) } : null;
    } else {
      statusCode = 503;
      code = 'DATABASE_ERROR';
      message = process.env.NODE_ENV === 'development' ? err.message : 'Database error occurred';
    }
  } else if (err.name === 'MulterError') {
    // Handle file upload errors
    statusCode = 400;
    code = 'FILE_UPLOAD_ERROR';
    message = err.message || 'File upload error';
  }
  
  // Sanitize error message in production for 500 errors
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'An internal server error occurred';
    details = null;
  }
  
  // Use standardized error response
  return sendError(res, {
    message,
    code,
    statusCode,
    details: process.env.NODE_ENV === 'development' ? details : (details && statusCode !== 500 ? details : null),
  });
};

/**
 * 404 handler
 */
export const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route ${req.originalUrl} not found`);
  error.statusCode = 404;
  error.code = 'NOT_FOUND';
  error.name = 'NotFoundError';
  next(error);
};

