/**
 * Single factory for every rate limiter in the app.
 *
 * Routes must not call `rateLimit()` from express-rate-limit directly — going
 * through here is what guarantees each limiter gets the shared Redis store, the
 * trusted-proxy-aware key, and the violation feedback loop that drives the IP
 * denylist. A limiter built by hand silently opts out of all three.
 */
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { sendError } from '../response.js';
import logger from '../logger.js';
import { isAllowlisted, recordViolation } from './denylist.js';
import { createStore } from './store.js';

export {
  banIp,
  unbanIp,
  listBans,
  isBanned,
  denylistStatus,
  startBanSync,
  stopBanSync,
} from './denylist.js';
export { breakerState, closeRateLimitRedis, rateLimitRedisEnabled } from './redis.js';

/**
 * The key a limiter counts against.
 *
 * `req.clientIp` is set by clientIp.middleware and equals `req.ip` unless a
 * trusted internal proxy (the dashboard) presented a verified end-user IP —
 * without that, every dashboard user would share one bucket.
 *
 * `ipKeyGenerator` normalizes IPv6 to a /56 subnet. Skipping it would let a
 * single client with a routed IPv6 prefix mint effectively unlimited keys.
 */
const keyFor = (req) => ipKeyGenerator(req.clientIp || req.ip || 'unknown');

/**
 * @param {object} opts
 * @param {string} opts.name       Stable namespace for the Redis keys. Changing
 *                                 it resets everyone's counters — treat as an id.
 * @param {number} opts.windowMs
 * @param {number} opts.limit
 * @param {string} opts.message    Human-readable 429 message.
 * @param {boolean} [opts.countsTowardBan=true]  Whether tripping this limiter
 *                                 escalates toward an IP ban. Set false for
 *                                 limiters that legitimate clients can trip by
 *                                 accident (see geo).
 */
export const createLimiter = ({
  name,
  windowMs,
  limit,
  message = 'Too many requests, please try again later.',
  countsTowardBan = true,
  ...rest
}) => {
  if (!name) throw new Error('createLimiter requires a stable `name`');

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(name),
    keyGenerator: keyFor,
    skip: (req) => isAllowlisted(req.clientIp || req.ip),
    handler: (req, res, _next, options) => {
      const ip = req.clientIp || req.ip;
      logger.warn('Rate limit exceeded', {
        requestId: req.requestId,
        limiter: name,
        ip,
        method: req.method,
        path: req.originalUrl,
      });

      if (countsTowardBan) {
        // Deliberately not awaited: the 429 must not wait on Redis, and
        // recordViolation swallows its own errors.
        void recordViolation(ip, { limiter: name, path: req.originalUrl });
      }

      return sendError(res, {
        message,
        code: 'RATE_LIMITED',
        statusCode: options.statusCode,
        details: { retryAfterSeconds: Math.ceil(options.windowMs / 1000) },
      });
    },
    ...rest,
  });
};
