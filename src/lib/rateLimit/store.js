/**
 * A rate-limit store that prefers Redis and degrades to memory.
 *
 * Why not plain RedisStore: express-rate-limit propagates store errors into the
 * request, so a Redis blip would turn every API call into a 500. Why not plain
 * MemoryStore: counters live in one process, so they reset on every deploy and
 * multiply by the instance count (N instances = N x the intended limit).
 *
 * This wrapper gets both properties — shared, restart-proof counters normally,
 * and a working limiter during a Redis outage. On fallback the memory counters
 * start cold, so a client mid-window gets a fresh budget; that is a deliberate
 * trade (brief over-permissiveness) over the alternatives (500s, or no limit).
 */
import { MemoryStore } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import logger from '../logger.js';
import {
  breakerOpen,
  getRateLimitRedis,
  keyPrefix,
  rateLimitRedisEnabled,
  recordRedisFailure,
  recordRedisSuccess,
} from './redis.js';

class ResilientStore {
  #options = null;
  #primary = null;

  constructor(namespace) {
    this.namespace = namespace;
    this.fallback = new MemoryStore();
    // `localKeys: false` tells express-rate-limit the keys are shared across
    // processes. It stays false even though the fallback is local — the steady
    // state is what matters for the header semantics.
    this.localKeys = false;
  }

  init(options) {
    this.#options = options;
    this.fallback.init?.(options);
  }

  /**
   * Build the RedisStore on demand.
   *
   * Deliberately NOT constructed eagerly. RedisStore's constructor fires
   * `SCRIPT LOAD` immediately and stores the *promise* on the instance; every
   * later increment awaits that same promise. So a Redis that is unreachable at
   * construction time poisons the store permanently — it keeps rejecting long
   * after Redis is healthy again — and the rejection is unhandled, which the
   * process-level unhandledRejection hook in index.js turns into an exit.
   *
   * Building lazily and discarding the instance on failure (see #withFallback)
   * means the next attempt after the breaker cooldown gets a fresh store with
   * fresh script promises, so the limiter heals on its own once Redis returns.
   */
  #getPrimary() {
    if (this.#primary) return this.#primary;
    this.#primary = new RedisStore({
      prefix: `${keyPrefix()}rl:${this.namespace}:`,
      // rate-limit-redis speaks node-redis; ioredis takes (cmd, ...args).
      sendCommand: (...args) => getRateLimitRedis().call(...args),
    });

    // The constructor kicks off two SCRIPT LOADs and parks their promises on the
    // instance. `getScriptSha` is only awaited if something calls store.get(),
    // which express-rate-limit may never do — so with Redis down it stays an
    // unhandled rejection, and index.js's unhandledRejection hook exits the
    // process. Attaching a no-op handler marks them handled without consuming
    // them: code that awaits these still sees the rejection normally.
    this.#primary.incrementScriptSha?.catch?.(() => {});
    this.#primary.getScriptSha?.catch?.(() => {});

    this.#primary.init?.(this.#options);
    return this.#primary;
  }

  /**
   * Run `op` against Redis, falling back to the memory store on any failure.
   * The breaker short-circuits straight to fallback during a known outage so we
   * don't pay the command timeout on every request.
   */
  async #withFallback(op, fallbackOp) {
    if (breakerOpen()) return fallbackOp(this.fallback);
    try {
      const result = await op(this.#getPrimary());
      recordRedisSuccess();
      return result;
    } catch (err) {
      recordRedisFailure(err);
      // Drop the instance: its cached script promises may be permanently
      // rejected, so reusing it would never recover.
      this.#primary = null;
      logger.warn('Rate-limit store fell back to memory', {
        namespace: this.namespace,
        error: err.message,
      });
      return fallbackOp(this.fallback);
    }
  }

  get(key) {
    return this.#withFallback(
      (s) => s.get(key),
      (s) => s.get?.(key),
    );
  }

  increment(key) {
    return this.#withFallback(
      (s) => s.increment(key),
      (s) => s.increment(key),
    );
  }

  decrement(key) {
    return this.#withFallback(
      (s) => s.decrement(key),
      (s) => s.decrement(key),
    );
  }

  resetKey(key) {
    return this.#withFallback(
      (s) => s.resetKey(key),
      (s) => s.resetKey(key),
    );
  }
}

/**
 * Build the store for a limiter. `namespace` keeps each limiter's counters
 * separate in Redis (the global /api budget must not consume the coupon
 * budget), and must be stable across deploys — it is part of the key.
 */
export const createStore = (namespace) => {
  if (!rateLimitRedisEnabled()) {
    logger.info('Rate limiting using in-memory store', { namespace });
    return new MemoryStore();
  }
  return new ResilientStore(namespace);
};
