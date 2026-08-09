/**
 * IP denylist with automatic escalation from repeated rate-limit violations.
 *
 * The read path is the design constraint: `isBanned()` runs on every request, so
 * it must not touch Redis. Instead each instance keeps a local snapshot of the
 * ban set and refreshes it on a timer (2 Redis commands per sync, not one per
 * request — the same per-command cost discipline the queue tuning follows).
 * The cost is propagation delay: an IP banned on instance A starts being blocked
 * by instance B within BAN_SYNC_MS. For abuse mitigation that is fine; this is
 * not an authorization control.
 *
 * Writes (violations, bans) are rare — they only happen on a 429 or an admin
 * action — so those take the Redis round trip directly.
 *
 * With no Redis configured the whole thing still works, just per-process.
 */
import { isIP } from 'node:net';
import logger from '../logger.js';
import {
  breakerOpen,
  getRateLimitRedis,
  keyPrefix,
  rateLimitRedisEnabled,
  recordRedisFailure,
  recordRedisSuccess,
} from './redis.js';

const K = {
  bans: () => `${keyPrefix()}bans`, // ZSET member=ip score=expiryMs
  meta: () => `${keyPrefix()}ban_meta`, // HASH ip -> JSON metadata
  violations: (ip) => `${keyPrefix()}viol:${ip}`, // counter, TTL = window
  offences: (ip) => `${keyPrefix()}offences:${ip}`, // counter, TTL = memory window
};

const cfg = () => ({
  enabled: (process.env.ENABLE_IP_BAN || 'true').toLowerCase() === 'true',
  // How many rate-limit rejections within the window earn a ban.
  threshold: Number(process.env.IP_BAN_VIOLATION_THRESHOLD || 5),
  violationWindowMs: Number(process.env.IP_BAN_VIOLATION_WINDOW_MS || 10 * 60 * 1000),
  baseBanMs: Number(process.env.IP_BAN_DURATION_MS || 60 * 60 * 1000),
  maxBanMs: Number(process.env.IP_BAN_MAX_DURATION_MS || 24 * 60 * 60 * 1000),
  // How long a past ban keeps counting toward the escalation multiplier.
  offenceMemoryMs: Number(process.env.IP_BAN_OFFENCE_MEMORY_MS || 7 * 24 * 60 * 60 * 1000),
  syncMs: Number(process.env.IP_BAN_SYNC_MS || 15_000),
});

/** Parse a comma-separated env list of IPs into a Set. */
const parseIpList = (raw) =>
  new Set(
    (raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

// Static lists are read once at module load — they are deploy-time config.
// ALLOWLIST wins over everything: put monitoring, the dashboard egress IP, and
// office IPs here so an automated ban can never lock out your own systems.
const STATIC_DENY = parseIpList(process.env.IP_DENYLIST);
const STATIC_ALLOW = parseIpList(process.env.IP_ALLOWLIST);

/** ip -> expiry epoch ms. Mirror of the Redis ZSET (or the source of truth without Redis). */
const localBans = new Map();
/**
 * Bans this instance applied but could not write to Redis (outage mid-ban).
 *
 * Needed to tell two identical-looking situations apart during a sync: a ban
 * missing from Redis because our write failed (keep it, retry the write) versus
 * one missing because another instance lifted it (drop it). Without this
 * distinction an admin unban is silently resurrected by every other instance's
 * cache and can never take effect.
 */
const pendingBans = new Set();
/** ip -> { count, windowStart } — only used when Redis is unavailable. */
const localViolations = new Map();

let syncTimer = null;
let lastSyncAt = 0;

const useRedis = () => rateLimitRedisEnabled() && !breakerOpen();

/** Allowlisted IPs skip both rate limiting and banning entirely. */
export const isAllowlisted = (ip) => Boolean(ip) && STATIC_ALLOW.has(ip);

/**
 * Synchronous ban check for the request path. Never awaits, never throws.
 */
export const isBanned = (ip) => {
  if (!ip || STATIC_ALLOW.has(ip)) return false;
  if (STATIC_DENY.has(ip)) return true;
  if (!cfg().enabled) return false;

  const until = localBans.get(ip);
  if (!until) return false;
  if (until <= Date.now()) {
    localBans.delete(ip);
    return false;
  }
  return true;
};

export const banExpiry = (ip) => localBans.get(ip) ?? null;

/**
 * Ban an IP. Called by the escalation path and by the admin endpoint.
 * Applies locally first so the banning instance enforces it immediately.
 */
export const banIp = async (ip, durationMs, reason = 'manual') => {
  if (!isIP(ip)) throw new Error(`Refusing to ban malformed IP: ${ip}`);
  if (STATIC_ALLOW.has(ip)) {
    logger.warn('Refusing to ban allowlisted IP', { ip, reason });
    return null;
  }

  const until = Date.now() + durationMs;
  localBans.set(ip, until);

  const record = { ip, until, reason, bannedAt: Date.now() };
  logger.warn('IP banned', { ip, reason, durationMs, until: new Date(until).toISOString() });

  if (!rateLimitRedisEnabled()) return record;
  if (!useRedis()) {
    // Circuit is open — don't even try, but remember to push it later.
    pendingBans.add(ip);
    return record;
  }
  try {
    const redis = getRateLimitRedis();
    await redis
      .multi()
      .zadd(K.bans(), until, ip)
      .hset(K.meta(), ip, JSON.stringify(record))
      .exec();
    recordRedisSuccess();
    pendingBans.delete(ip);
  } catch (err) {
    recordRedisFailure(err);
    pendingBans.add(ip);
    logger.error('Failed to persist IP ban to Redis — ban is local until the next sync', {
      ip,
      error: err.message,
    });
  }
  return record;
};

export const unbanIp = async (ip) => {
  localBans.delete(ip);
  pendingBans.delete(ip);
  logger.info('IP unbanned', { ip });
  if (!useRedis()) return;
  try {
    const redis = getRateLimitRedis();
    await redis.multi().zrem(K.bans(), ip).hdel(K.meta(), ip).del(K.offences(ip)).del(K.violations(ip)).exec();
    recordRedisSuccess();
  } catch (err) {
    recordRedisFailure(err);
    logger.error('Failed to clear IP ban in Redis', { ip, error: err.message });
  }
};

/**
 * Ban length doubles per prior offence within the memory window, capped.
 * One bad afternoon costs an hour; a persistent scraper works up to a day.
 */
const escalatedDuration = (priorOffences) => {
  const { baseBanMs, maxBanMs } = cfg();
  return Math.min(baseBanMs * 2 ** Math.max(0, priorOffences - 1), maxBanMs);
};

/**
 * Record one rate-limit rejection for an IP, banning it once it crosses the
 * threshold. Fire-and-forget: callers must not await this in the request path,
 * and it never throws.
 */
export const recordViolation = async (ip, context = {}) => {
  const c = cfg();
  if (!c.enabled || !ip || STATIC_ALLOW.has(ip) || !isIP(ip)) return;
  if (isBanned(ip)) return; // already banned; nothing to escalate

  try {
    let violations;
    let offences;

    if (useRedis()) {
      const redis = getRateLimitRedis();
      // INCR then set the TTL only on first write, so the window is fixed from
      // the first violation rather than sliding forward with every new one.
      const [[, count]] = await redis
        .multi()
        .incr(K.violations(ip))
        .pexpire(K.violations(ip), c.violationWindowMs, 'NX')
        .exec();
      recordRedisSuccess();
      violations = Number(count);
      if (violations < c.threshold) return;

      const [[, off]] = await redis
        .multi()
        .incr(K.offences(ip))
        .pexpire(K.offences(ip), c.offenceMemoryMs)
        .exec();
      offences = Number(off);
    } else {
      const now = Date.now();
      const entry = localViolations.get(ip);
      if (!entry || now - entry.windowStart > c.violationWindowMs) {
        localViolations.set(ip, { count: 1, windowStart: now });
        return;
      }
      entry.count++;
      violations = entry.count;
      if (violations < c.threshold) return;
      localViolations.delete(ip);
      offences = 1; // no cross-restart memory without Redis
    }

    await banIp(ip, escalatedDuration(offences), 'rate_limit_violations');
    logger.warn('IP auto-banned after repeated rate-limit violations', {
      ip,
      violations,
      offences,
      ...context,
    });
  } catch (err) {
    // Never let ban bookkeeping affect the response — the 429 already went out.
    logger.error('Failed to record rate-limit violation', { ip, error: err.message });
  }
};

/**
 * Re-push bans whose original Redis write failed, so an outage that started
 * mid-ban doesn't leave the ban enforced on only one instance forever.
 */
const flushPendingBans = async () => {
  const redis = getRateLimitRedis();
  for (const ip of [...pendingBans]) {
    const until = localBans.get(ip);
    if (!until || until <= Date.now()) {
      pendingBans.delete(ip);
      continue;
    }
    try {
      await redis
        .multi()
        .zadd(K.bans(), until, ip)
        .hset(K.meta(), ip, JSON.stringify({ ip, until, reason: 'resynced', bannedAt: Date.now() }))
        .exec();
      pendingBans.delete(ip);
      logger.info('Re-synced previously unwritten IP ban to Redis', { ip });
    } catch (err) {
      recordRedisFailure(err);
      break; // Redis is unhappy again; leave the rest for the next sync.
    }
  }
};

/**
 * Pull the authoritative ban set into the local cache and drop expired entries.
 * Two commands per call regardless of ban count.
 */
export const syncBans = async () => {
  // Expire local entries even when Redis is unavailable, so a ban still lifts
  // on schedule during an outage instead of becoming permanent.
  const now = Date.now();
  for (const [ip, until] of localBans) {
    if (until <= now) localBans.delete(ip);
  }

  if (!rateLimitRedisEnabled() || breakerOpen()) return;

  try {
    const redis = getRateLimitRedis();
    const [, [, rows]] = await redis
      .multi()
      .zremrangebyscore(K.bans(), '-inf', now)
      .zrange(K.bans(), 0, -1, 'WITHSCORES')
      .exec();
    recordRedisSuccess();

    const fresh = new Map();
    for (let i = 0; i < rows.length; i += 2) {
      fresh.set(rows[i], Number(rows[i + 1]));
    }

    // Redis is authoritative: anything it no longer lists has been lifted (by an
    // admin on another instance, or by expiry) and must disappear here too.
    // The ONLY exception is a ban whose write we know failed — those are ours to
    // keep and to retry, and they are tracked explicitly rather than inferred
    // from "present locally but absent in Redis", which an unban also looks like.
    for (const ip of pendingBans) {
      const until = localBans.get(ip);
      if (!until || until <= now) {
        pendingBans.delete(ip);
        continue;
      }
      fresh.set(ip, until);
    }

    localBans.clear();
    for (const [ip, until] of fresh) localBans.set(ip, until);
    lastSyncAt = now;

    // Redis answered, so now is the moment to flush bans that never landed.
    if (pendingBans.size > 0) await flushPendingBans();
  } catch (err) {
    recordRedisFailure(err);
    logger.warn('Ban list sync failed — serving from last known snapshot', { error: err.message });
  }
};

export const startBanSync = () => {
  if (syncTimer || !cfg().enabled) return;

  // Prime the cache so a restarting instance doesn't serve a window of requests
  // with an empty ban list. The client is configured with enableOfflineQueue:
  // false, so a command issued before the socket is up rejects outright — hence
  // priming on 'ready' rather than immediately. The interval below is the
  // backstop if that event never comes.
  if (rateLimitRedisEnabled()) {
    const client = getRateLimitRedis();
    if (client.status === 'ready') {
      syncBans().catch(() => {});
    } else {
      client.once('ready', () => {
        syncBans().catch(() => {});
      });
    }
  }

  syncTimer = setInterval(() => {
    syncBans().catch(() => {});
  }, cfg().syncMs);
  // Don't hold the event loop open on shutdown.
  syncTimer.unref?.();
  logger.info('IP ban sync started', { intervalMs: cfg().syncMs });
};

export const stopBanSync = () => {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
};

/** Admin view: current bans with their metadata. */
export const listBans = async () => {
  await syncBans();
  let meta = {};
  if (useRedis()) {
    try {
      meta = (await getRateLimitRedis().hgetall(K.meta())) || {};
      recordRedisSuccess();
    } catch (err) {
      recordRedisFailure(err);
    }
  }
  return Array.from(localBans.entries()).map(([ip, until]) => {
    let parsed = {};
    try {
      parsed = meta[ip] ? JSON.parse(meta[ip]) : {};
    } catch {
      /* metadata is best-effort */
    }
    return {
      ip,
      until: new Date(until).toISOString(),
      remainingMs: Math.max(0, until - Date.now()),
      reason: parsed.reason || 'unknown',
      bannedAt: parsed.bannedAt ? new Date(parsed.bannedAt).toISOString() : null,
    };
  });
};

export const denylistStatus = () => ({
  enabled: cfg().enabled,
  backend: rateLimitRedisEnabled() ? 'redis' : 'memory',
  cachedBans: localBans.size,
  pendingBans: pendingBans.size,
  staticDeny: STATIC_DENY.size,
  staticAllow: STATIC_ALLOW.size,
  lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null,
  config: cfg(),
});
