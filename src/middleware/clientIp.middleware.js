/**
 * Resolves the real end-user IP into `req.clientIp`.
 *
 * The problem this solves: the dashboard's Next route handlers proxy to this
 * API server-side (lib/authProxy.ts). Those requests arrive from the dashboard's
 * egress IP, so without this every dashboard user shares one rate-limit bucket —
 * the limiter is simultaneously useless as protection and a self-inflicted DoS.
 *
 * Why a shared secret rather than X-Forwarded-For: with `trust proxy = 1`, an
 * XFF entry added by the dashboard is honoured — but so is one added by anybody
 * else, because the backend cannot tell the two apart. Any client could then
 * pick its own rate-limit key and bypass limiting entirely. Origin-IP
 * allowlisting doesn't fix it either: dashboard egress IPs are dynamic on
 * managed hosts. A secret the proxy holds and attackers don't is the property we
 * actually need.
 *
 * Fails closed onto `req.ip`: an unsigned, mis-signed, or malformed claim is
 * ignored, never trusted.
 */
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import logger from '../lib/logger.js';

export const CLIENT_IP_HEADER = 'x-nubian-client-ip';
export const PROXY_SECRET_HEADER = 'x-nubian-proxy-secret';

/** Constant-time compare that tolerates length mismatches without leaking them. */
const secretMatches = (presented, expected) => {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still burn a comparison so the reject path isn't obviously faster.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
};

let warnedMissingSecret = false;

export const resolveClientIp = (req, _res, next) => {
  req.clientIp = req.ip;

  const claimed = req.get(CLIENT_IP_HEADER);
  if (!claimed) return next();

  const expected = process.env.INTERNAL_PROXY_SECRET;
  if (!expected) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      logger.warn(
        `Received ${CLIENT_IP_HEADER} but INTERNAL_PROXY_SECRET is not set — ignoring ` +
          'the forwarded IP. Set the same secret here and in the dashboard, or ' +
          'proxied traffic will keep sharing one rate-limit bucket.'
      );
    }
    return next();
  }

  if (!secretMatches(req.get(PROXY_SECRET_HEADER), expected)) {
    logger.warn('Rejected client-IP claim with bad proxy secret', {
      requestId: req.requestId,
      ip: req.ip,
      path: req.originalUrl,
    });
    return next();
  }

  // A verified proxy can still send garbage. Anything that isn't a literal IP
  // would become an unbounded rate-limit key space.
  if (!isIP(claimed)) {
    logger.warn('Rejected malformed forwarded client IP', {
      requestId: req.requestId,
      claimed: String(claimed).slice(0, 64),
    });
    return next();
  }

  req.clientIp = claimed;
  req.viaTrustedProxy = true;
  return next();
};
