/**
 * Collection rules.
 *
 * A Collection is a *curated, ordered* list of products — "Ramadan Favorites",
 * "Best Sellers". The relationship is owned by the Collection (an ordered array
 * of product ids); Product is deliberately untouched, so a product can sit in
 * any number of collections and nothing about the product pipeline changes.
 *
 * This module is dependency-free (no mongoose, no express) for the same reason
 * `bannerTarget.js` is: the model, the express-validator schema and the unit
 * tests all need the same rules, and only one of them can afford a database.
 *
 * The dashboard mirrors these limits in `src/lib/collection.ts`; this file is
 * the source of truth — change it here first.
 */

/** Cap on the display name. Long enough for a campaign title, short enough for a card. */
export const COLLECTION_NAME_MIN = 2;
export const COLLECTION_NAME_MAX = 120;

/** Optional blurb shown under the title on the collection screen. */
export const COLLECTION_DESCRIPTION_MAX = 1000;

/** Slugs are generated from the name but may be supplied explicitly. */
export const COLLECTION_SLUG_MAX = 140;

/**
 * Upper bound on curated products.
 *
 * A collection is hand-picked, not a saved search, so this is a sanity limit
 * rather than a product decision — it is what stops a single admin request from
 * writing an unbounded array into one document and makes the "fetch every
 * referenced product" read in the controller predictably cheap.
 */
export const COLLECTION_PRODUCTS_MAX = 200;

/** Same bounds the banner order field uses, for consistency in the admin UI. */
export const COLLECTION_SORT_ORDER_MIN = 0;
export const COLLECTION_SORT_ORDER_MAX = 100000;

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

export const isObjectIdLike = (value) =>
  typeof value === 'string' && OBJECT_ID_RE.test(value.trim());

/** `^[a-z0-9]+(?:-[a-z0-9]+)*$` — lowercase words joined by single hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Derive a URL-safe slug from a display name.
 *
 * Arabic is a first-class input here — the dashboard is Arabic-first and most
 * collections will be named in it. Unicode letters and digits are kept as-is
 * (Mongo and every client in this stack are UTF-8 throughout) and only the
 * separators are normalised, so "مفضلات رمضان" becomes "مفضلات-رمضان" instead
 * of collapsing to an empty string the way an ASCII-only slugifier would.
 */
export const slugify = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    // Anything that is not a letter, a number or a hyphen becomes a separator.
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, COLLECTION_SLUG_MAX)
    // A trailing hyphen can reappear after the slice.
    .replace(/-+$/g, '');
};

/**
 * Validate the `products` field of a write request.
 *
 * Returns `{ ok: true, value }` with the canonical ordered id list (trimmed,
 * order preserved) or `{ ok: false, message }` describing the first violation.
 *
 * Order is the whole point: the admin drags products into the sequence shoppers
 * will see, so this never sorts, de-duplicates silently or otherwise reorders —
 * a duplicate is an error the admin has to resolve, because collapsing it would
 * silently change the numbering they just set.
 */
export const validateCollectionProducts = (raw) => {
  if (raw === undefined || raw === null) return { ok: true, value: [] };

  if (!Array.isArray(raw)) {
    return { ok: false, message: 'products must be an array of product ids' };
  }

  if (raw.length > COLLECTION_PRODUCTS_MAX) {
    return {
      ok: false,
      message: `products may contain at most ${COLLECTION_PRODUCTS_MAX} items`,
    };
  }

  const seen = new Set();
  const value = [];

  for (const entry of raw) {
    // Accept both a bare id and `{ _id }` — the dashboard's picker hands back
    // option objects, and unwrapping here beats a mapping step in every caller.
    const candidate =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry._id ?? entry.id)
        : entry;

    if (!isObjectIdLike(candidate)) {
      return { ok: false, message: 'products must contain valid MongoDB ObjectIds' };
    }

    const id = String(candidate).trim();
    if (seen.has(id)) {
      return { ok: false, message: `products contains a duplicate product id (${id})` };
    }

    seen.add(id);
    value.push(id);
  }

  return { ok: true, value };
};

/**
 * The wire shape of a collection, everywhere it appears.
 *
 * Lives here rather than in the controller because the home payload builds one
 * too, and importing the controller from `home.controller.js` would close an
 * import cycle (the collection controller already imports `invalidateHomeCache`
 * from it). A pure mapper in the shared module is the way out.
 *
 * `productCount` is passed in rather than read off the document: the listing
 * and home payloads report the curated size (cheap), while the detail endpoint
 * reports how many are actually available to the shopper.
 */
export const toCollectionSummary = (doc, productCount) => ({
  _id: doc._id,
  name: doc.name,
  slug: doc.slug,
  description: doc.description || '',
  image: doc.image || null,
  isActive: doc.isActive,
  sortOrder: doc.sortOrder ?? 0,
  productCount,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

/**
 * Reorder `products` to match `orderedIds`, dropping anything not in the list.
 *
 * Used to project a set of *available* products back onto the admin's ordering
 * after the unavailable ones have been filtered out. `[A, B, C, D]` with B
 * deleted yields `[A, C, D]` — the survivors keep their relative order rather
 * than falling back to insertion or alphabetical order.
 *
 * @param {Array<string>} orderedIds  ids in the order the admin curated
 * @param {Array<object>} products    documents in arbitrary (query) order
 * @param {(doc: object) => string} getId
 */
export const orderByIds = (orderedIds, products, getId = (doc) => String(doc?._id)) => {
  const byId = new Map();
  for (const doc of products) {
    const key = getId(doc);
    if (key) byId.set(key, doc);
  }

  const out = [];
  for (const id of orderedIds) {
    const doc = byId.get(String(id));
    if (doc !== undefined) out.push(doc);
  }
  return out;
};
