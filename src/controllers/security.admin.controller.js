/**
 * Admin tooling for the IP denylist.
 *
 * Automatic bans need a manual escape hatch — a shared NAT egress or a
 * misbehaving partner integration will eventually get caught, and the fix has to
 * be faster than a redeploy.
 */
import { isIP } from 'node:net';
import { banIp, unbanIp, listBans, denylistStatus } from '../lib/rateLimit/denylist.js';
import { breakerState, rateLimitRedisEnabled } from '../lib/rateLimit/redis.js';
import { sendSuccess, sendError } from '../lib/response.js';
import logger from '../lib/logger.js';

const MAX_BAN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** GET /api/admin/security/status */
export const getSecurityStatus = async (_req, res) => {
  return sendSuccess(res, {
    data: {
      denylist: denylistStatus(),
      rateLimitStore: rateLimitRedisEnabled() ? 'redis' : 'memory',
      redisCircuit: breakerState(),
    },
    message: 'Security status',
  });
};

/** GET /api/admin/security/bans */
export const getBans = async (_req, res) => {
  const bans = await listBans();
  return sendSuccess(res, { data: bans, message: `${bans.length} active ban(s)` });
};

/** POST /api/admin/security/bans  body: { ip, durationMs?, reason? } */
export const createBan = async (req, res) => {
  const { ip, durationMs, reason } = req.body || {};

  if (!ip || !isIP(ip)) {
    return sendError(res, {
      message: 'A valid IPv4 or IPv6 address is required.',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  }

  const duration = Number(durationMs ?? 60 * 60 * 1000);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_BAN_MS) {
    return sendError(res, {
      message: `durationMs must be between 1 and ${MAX_BAN_MS} (30 days).`,
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  }

  const record = await banIp(ip, duration, reason ? `admin:${reason}` : 'admin');
  if (!record) {
    return sendError(res, {
      message: 'That IP is allowlisted and cannot be banned. Remove it from IP_ALLOWLIST first.',
      code: 'IP_ALLOWLISTED',
      statusCode: 409,
    });
  }

  logger.warn('Admin banned IP', { ip, durationMs: duration, reason, by: req.auth?.userId });
  return sendSuccess(res, {
    data: { ...record, until: new Date(record.until).toISOString() },
    message: 'IP banned',
    statusCode: 201,
  });
};

/** DELETE /api/admin/security/bans/:ip */
export const deleteBan = async (req, res) => {
  const { ip } = req.params;
  if (!isIP(ip)) {
    return sendError(res, {
      message: 'A valid IPv4 or IPv6 address is required.',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  }
  await unbanIp(ip);
  logger.info('Admin unbanned IP', { ip, by: req.auth?.userId });
  return sendSuccess(res, { data: { ip }, message: 'IP unbanned' });
};
