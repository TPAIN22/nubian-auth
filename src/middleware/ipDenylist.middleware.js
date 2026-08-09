/**
 * Rejects requests from banned IPs before they reach routing, auth, or the DB.
 *
 * Mounted early and deliberately cheap: the check is a synchronous Map lookup
 * against a locally cached snapshot of the ban set (see lib/rateLimit/denylist),
 * so a banned IP costs essentially nothing to serve.
 */
import { isBanned, banExpiry } from '../lib/rateLimit/denylist.js';
import { sendError } from '../lib/response.js';
import logger from '../lib/logger.js';

export const ipDenylist = (req, res, next) => {
  const ip = req.clientIp || req.ip;
  if (!isBanned(ip)) return next();

  const until = banExpiry(ip);
  const retryAfterSeconds = until ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : undefined;
  if (retryAfterSeconds) res.set('Retry-After', String(retryAfterSeconds));

  logger.warn('Blocked request from banned IP', {
    requestId: req.requestId,
    ip,
    method: req.method,
    path: req.originalUrl,
  });

  // 403, not 429: this is not "slow down", it is "you are blocked". Deliberately
  // says nothing about why or for how long it was earned.
  return sendError(res, {
    message: 'Access from this IP address has been temporarily blocked.',
    code: 'IP_BLOCKED',
    statusCode: 403,
    ...(retryAfterSeconds ? { details: { retryAfterSeconds } } : {}),
  });
};
