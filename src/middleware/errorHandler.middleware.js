import logger from '../lib/logger.js';

/**
 * Centralized error handling middleware
 * Sanitizes error messages and provides consistent error responses
 */
export const errorHandler = (err, req, res, next) => {
  const requestId = req.requestId || 'unknown';
  
  // Log error with request ID
  logger.error('Error occurred', {
    requestId,
    error: {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      name: err.name,
    },
    method: req.method,
    url: req.url,
  });
  
  // Default error
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal server error';
  let code = err.code || 'INTERNAL_ERROR';
  let details = null;
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation error';
    details = err.details || err.errors;
  } else if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
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
    }
  } else if (err.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_ID';
    message = 'Invalid ID format';
  }
  
  // Sanitize error message in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'An internal server error occurred';
    details = null;
  }
  
  // Send error response
  const errorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
      requestId,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  };
  
  res.status(statusCode).json(errorResponse);
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

