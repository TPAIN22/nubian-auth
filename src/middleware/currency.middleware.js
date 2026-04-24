import logger from '../lib/logger.js';

const CURRENCY_RE = /^[A-Z]{2,3}$/;
const COUNTRY_RE  = /^[A-Z]{2,3}$/;

function sanitizeCurrencyCode(raw, fallback) {
  const upper = String(raw || '').trim().toUpperCase();
  return CURRENCY_RE.test(upper) ? upper : fallback;
}

function sanitizeCountryCode(raw, fallback) {
  const upper = String(raw || '').trim().toUpperCase();
  return COUNTRY_RE.test(upper) ? upper : fallback;
}

export const currencyMiddleware = (req, _res, next) => {
  // Priority: 1. Query param  2. Request header  3. Default
  const rawCurrency = req.query.currencyCode || req.query.currency || req.headers['x-currency'];
  const rawCountry  = req.query.countryCode  || req.query.country  || req.headers['x-country'];

  req.currencyCode = sanitizeCurrencyCode(rawCurrency, 'USD');
  req.countryCode  = sanitizeCountryCode(rawCountry,   'US');

  if (req.currencyCode !== 'USD') {
    logger.debug('Currency detected', {
      requestId:    req.requestId,
      currencyCode: req.currencyCode,
      countryCode:  req.countryCode,
      source:       req.headers['x-currency'] ? 'header' : 'query',
    });
  }

  next();
};
