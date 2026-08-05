/**
 * Platform pricing configuration.
 *
 * `NUBIAN_MARKUP` is the single knob for Nubian's default margin — the
 * percentage added on top of a merchant's price to get the listed price.
 * Change it in `.env`, restart, done: no code edit, no redeploy of the other
 * apps, no schema change.
 *
 * What it does and does NOT affect:
 *   - It is the DEFAULT. A variant that already carries an explicit
 *     `nubianMarkup` (admin-set, or written by an earlier migration) keeps it.
 *     Changing this env var does not rewrite existing rows — run
 *     `node src/scripts/migrate_nubian_markup.js` for that.
 *   - New variants created without a markup get this value (schema default).
 *   - Every legacy/fallback code path that has to invent a markup because the
 *     stored document predates the field uses this value.
 *
 * The clients keep their own mirror of this value purely as an offline
 * fallback for un-enriched payloads — backend prices always win:
 *   dashboard → NEXT_PUBLIC_NUBIAN_MARKUP   (src/lib/pricing.config.ts)
 *   mobile    → EXPO_PUBLIC_NUBIAN_MARKUP   (constants/pricing.ts)
 * Keep the three in sync when you change one.
 */

import logger from './logger.js';

/** Used when NUBIAN_MARKUP is unset or unusable. */
export const NUBIAN_MARKUP_FALLBACK = 30;

/** Bounds mirror the `nubianMarkup` schema constraints in product.model.js. */
export const NUBIAN_MARKUP_MIN = 0;
export const NUBIAN_MARKUP_MAX = 200;

function resolveDefaultMarkup() {
  const raw = process.env.NUBIAN_MARKUP;
  if (raw === undefined || String(raw).trim() === '') return NUBIAN_MARKUP_FALLBACK;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < NUBIAN_MARKUP_MIN || parsed > NUBIAN_MARKUP_MAX) {
    logger.warn(
      `NUBIAN_MARKUP="${raw}" is not a number between ${NUBIAN_MARKUP_MIN} and ` +
        `${NUBIAN_MARKUP_MAX} — falling back to ${NUBIAN_MARKUP_FALLBACK}%.`
    );
    return NUBIAN_MARKUP_FALLBACK;
  }
  return parsed;
}

/**
 * Default Nubian margin, in percent. Read once at import — `dotenv/config` is
 * the first import in src/index.js, and standalone scripts/workers call
 * `dotenv.config()` before importing models, so `.env` is always loaded by now.
 */
export const DEFAULT_NUBIAN_MARKUP = resolveDefaultMarkup();
