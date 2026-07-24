/**
 * In-process TTL + LRU cache for geo lookups.
 *
 * Geocoding is the single most expensive call in the address flow and the most
 * repetitive: every shopper who drags the map across the same block asks the
 * same question. Caching on a snapped coordinate grid collapses those into one
 * upstream call.
 *
 * Deliberately in-process (no Redis dependency): geo results are cheap to
 * recompute, perfectly shareable, and we never want a Redis outage to break
 * address entry. `REDIS_URL` stays reserved for the notification queues.
 */

const DEFAULT_MAX_ENTRIES = 5000;

export class TtlCache {
  /**
   * @param {{ maxEntries?: number, ttlMs?: number }} [options]
   */
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    /** @type {Map<string, { value: unknown, expiresAt: number }>} */
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }

    // Re-insert to move the key to the tail — Map preserves insertion order, so
    // the oldest key is always the first one iterated during eviction.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });

    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear() {
    this.store.clear();
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? Number((this.hits / total).toFixed(4)) : 0,
    };
  }
}

/**
 * Snap a coordinate to a grid so nearby pins share a cache entry.
 *
 * 4 decimal places ≈ 11 m at the equator — finer than any building entrance a
 * courier cares about, coarse enough that dragging the map a few pixels reuses
 * the cached label instead of billing another lookup.
 */
export const snapCoordinate = (lat, lng, precision = 4) => {
  const factor = 10 ** precision;
  return {
    lat: Math.round(Number(lat) * factor) / factor,
    lng: Math.round(Number(lng) * factor) / factor,
  };
};

export const reverseKey = (provider, lat, lng, language) => {
  const snapped = snapCoordinate(lat, lng);
  return `rev:${provider}:${language}:${snapped.lat},${snapped.lng}`;
};

export const searchKey = (provider, query, language, lat, lng) => {
  const near =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? (() => {
          // 2 decimals ≈ 1.1 km: enough bias granularity for ranking, and it
          // keeps the key space small.
          const s = snapCoordinate(lat, lng, 2);
          return `${s.lat},${s.lng}`;
        })()
      : '-';

  return `search:${provider}:${language}:${near}:${String(query).trim().toLowerCase()}`;
};

export const placeKey = (provider, id, language) => `place:${provider}:${language}:${id}`;
