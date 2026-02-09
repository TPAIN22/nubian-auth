import logger from "../lib/logger.js";

/**
 * Currency Middleware
 * Extracts x-currency and x-country headers and attaches them to req object
 * Also handles backward compatibility for query parameters
 */
export const currencyMiddleware = (req, res, next) => {
  // Priority: 1. Query Param, 2. Headers, 3. Default 'USD'/'US'
  const currencyCode = (
    req.query.currencyCode || 
    req.query.currency || 
    req.headers['x-currency'] || 
    'USD'
  ).toUpperCase();

  const countryCode = (
    req.query.countryCode || 
    req.query.country || 
    req.headers['x-country'] || 
    'US'
  ).toUpperCase();

  // Attach to req for controllers to use
  req.currencyCode = currencyCode;
  req.countryCode = countryCode;

  // Also ensure they are in req.query for controllers that might only check req.query
  if (!req.query.currencyCode) req.query.currencyCode = currencyCode;
  
  // Log if it's not the default (for debugging)
  if (currencyCode !== 'USD') {
    logger.debug('Currency detected', { 
      requestId: req.requestId, 
      currencyCode, 
      countryCode,
      source: req.headers['x-currency'] ? 'header' : 'query'
    });
  }

  next();
};
