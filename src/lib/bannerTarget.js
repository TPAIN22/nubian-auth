/**
 * Banner → Target.
 *
 * A banner is an image plus, optionally, a destination. Rather than growing a
 * field per destination (storeId, productId, categoryId, …) the destination is
 * a single tagged union:
 *
 *   { type: 'store' | 'collection' | 'product' | 'category', id: <ObjectId> }
 *   { type: 'url', url: 'https://…' }
 *   { type: 'none' }
 *
 * Exactly one of `id` / `url` is meaningful for any given type, and this module
 * is the single authority on which combinations are legal. It is deliberately
 * dependency-free (no mongoose, no express) so the same rules can be unit
 * tested in isolation and reused by the model, the validator and the service.
 *
 * The mobile app mirrors these rules in `utils/bannerTarget.ts`; the dashboard
 * mirrors them in the banner form's zod schema. This file is the source of
 * truth — change it here first.
 */

/** Every type the schema will store. Order is the order shown in the admin UI. */
export const BANNER_TARGET_TYPES = Object.freeze([
  'none',
  'store',
  'collection',
  'product',
  'category',
  'url',
]);

/** Types whose destination is an entity referenced by `_id`. */
export const BANNER_TARGET_TYPES_WITH_ID = Object.freeze([
  'store',
  'collection',
  'product',
  'category',
]);

/** The canonical "static banner" target. Also what a missing target means. */
export const NONE_TARGET = Object.freeze({ type: 'none' });

/**
 * Target types that are modelled and validated but cannot resolve yet because
 * the underlying entity does not exist in this codebase.
 *
 * Currently empty: `collection` used to live here while Collections were only a
 * placeholder in the schema, and was removed when `models/collection.model.js`
 * landed and `services/bannerTarget.service.js` gained a resolver for it. The
 * export is kept because it is the switch that turns a *future* type on — the
 * schema can accept a type before the API is willing to create one.
 */
export const BANNER_TARGET_TYPES_UNSUPPORTED = Object.freeze([]);

/** Mirrors express-validator's `isMongoId()` without pulling in the dependency. */
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

/**
 * Cap on a stored target URL. Long enough for real campaign links with UTM
 * parameters, short enough that a banner row can never become an payload.
 */
export const BANNER_TARGET_URL_MAX = 2048;

export const isObjectIdLike = (value) =>
  typeof value === 'string' && OBJECT_ID_RE.test(value.trim());

/**
 * Is this URL safe to hand to a browser / `Linking.openURL` on a user's device?
 *
 * The banner target is admin-authored, but "admin-authored" is not the same as
 * "trusted forever" — a compromised admin session must not be able to ship a
 * `javascript:` or `data:` payload to every phone on the home screen. So the
 * scheme is an allowlist rather than a denylist, and embedded credentials are
 * rejected because `https://accounts.google.com@evil.example` reads as Google
 * to a human and resolves to the attacker.
 */
export const isSafeBannerUrl = (value) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > BANNER_TARGET_URL_MAX) return false;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (parsed.hostname === '') return false;

  return true;
};

/**
 * Validate a raw target from a request body.
 *
 * Returns `{ ok: true, value }` with the canonical target (extra keys dropped,
 * strings trimmed) or `{ ok: false, message }` describing the first violation.
 *
 * A missing/null target is valid and normalises to `none`, which is what keeps
 * every banner created before this feature existed working unchanged.
 */
export const validateBannerTarget = (raw) => {
  if (raw === undefined || raw === null) {
    return { ok: true, value: { ...NONE_TARGET } };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'target must be an object' };
  }

  const type = raw.type === undefined || raw.type === null ? 'none' : raw.type;

  if (typeof type !== 'string' || !BANNER_TARGET_TYPES.includes(type)) {
    return {
      ok: false,
      message: `target.type must be one of: ${BANNER_TARGET_TYPES.join(', ')}`,
    };
  }

  // Treat empty strings as absent: the dashboard clears a field by blanking it,
  // and `{ type: 'none', id: '' }` should not read as "none carries an id".
  const hasId = raw.id !== undefined && raw.id !== null && String(raw.id).trim() !== '';
  const hasUrl = raw.url !== undefined && raw.url !== null && String(raw.url).trim() !== '';

  if (type === 'none') {
    if (hasId || hasUrl) {
      return { ok: false, message: 'target.type "none" must not carry an id or a url' };
    }
    return { ok: true, value: { ...NONE_TARGET } };
  }

  if (type === 'url') {
    if (hasId) {
      return { ok: false, message: 'target.type "url" must not carry an id' };
    }
    if (!hasUrl) {
      return { ok: false, message: 'target.url is required when target.type is "url"' };
    }
    const url = String(raw.url).trim();
    if (!isSafeBannerUrl(url)) {
      return {
        ok: false,
        message:
          'target.url must be an absolute http(s) URL without embedded credentials ' +
          `and at most ${BANNER_TARGET_URL_MAX} characters`,
      };
    }
    return { ok: true, value: { type: 'url', url } };
  }

  // Everything left is an entity reference.
  if (hasUrl) {
    return { ok: false, message: `target.type "${type}" must not carry a url` };
  }
  if (!hasId) {
    return { ok: false, message: `target.id is required when target.type is "${type}"` };
  }
  const id = String(raw.id).trim();
  if (!isObjectIdLike(id)) {
    return { ok: false, message: 'target.id must be a valid MongoDB ObjectId' };
  }

  return { ok: true, value: { type, id } };
};

/**
 * Canonical target for a banner document that may predate this feature.
 * Never throws — reads always degrade to `none` rather than failing.
 */
export const normalizeBannerTarget = (raw) => {
  const result = validateBannerTarget(raw);
  return result.ok ? result.value : { ...NONE_TARGET };
};
