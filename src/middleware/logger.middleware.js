import { randomUUID } from 'crypto';
import logger from '../lib/logger.js';

/**
 * Middleware to add request ID and log requests/responses
 * Provides request/response logging with timing and correlation ID tracking
 */
export const requestLogger = (req, res, next) => {
  // Generate unique request ID (or use existing from header for distributed tracing)
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.requestId = requestId;
  
  // Add request ID to response headers for correlation
  res.setHeader('X-Request-ID', requestId);
  
  const startTime = Date.now();
  const startTimeHR = process.hrtime.bigint();
  
  // Extract relevant request information
  const requestInfo = {
    requestId,
    method: req.method,
    url: req.originalUrl || req.url,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress,
    userAgent: req.get('user-agent'),
    contentType: req.get('content-type'),
    contentLength: req.get('content-length'),
  };
  
  // Log incoming request
  logger.info('Incoming request', requestInfo);
  
  // Override res.json to log response with timing
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    const duration = Date.now() - startTime;
    const durationHR = Number(process.hrtime.bigint() - startTimeHR) / 1000000; // Convert to milliseconds
    
    // Log response
    logger.info('Outgoing response', {
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      durationHR: `${durationHR.toFixed(2)}ms`,
      responseSize: JSON.stringify(data).length,
    });
    
    return originalJson(data);
  };
  
  // Override res.send for non-JSON responses
  const originalSend = res.send.bind(res);
  res.send = function(data) {
    const duration = Date.now() - startTime;
    
    logger.info('Outgoing response', {
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentType: res.get('content-type'),
    });
    
    return originalSend(data);
  };
  
  // Log request completion (including errors)
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    };
    
    if (res.statusCode >= 500) {
      logger.error('Request completed with server error', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request completed with client error', logData);
    } else {
      logger.debug('Request completed successfully', logData);
    }
  });
  
  // Log request errors
  res.on('error', (error) => {
    logger.error('Response error', {
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      error: error.message,
      stack: error.stack,
    });
  });
  
  next();
};

