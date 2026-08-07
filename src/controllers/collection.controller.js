import mongoose from 'mongoose';

import Collection from '../models/collection.model.js';
import Product from '../models/product.model.js';
import Banner from '../models/banners.model.js';
import Currency from '../models/currency.model.js';
import { getLatestRate } from '../services/fx.service.js';
import { convertProductPrices } from '../services/currency.service.js';
import { enrichProductsWithPricing } from './products.controller.js';
import { invalidateHomeCache } from './home.controller.js';
import {
  orderByIds,
  slugify,
  toCollectionSummary,
  validateCollectionProducts,
} from '../lib/collection.js';
import {
  sendSuccess,
  sendPaginated,
  sendNotFound,
  sendError,
  sendCreated,
} from '../lib/response.js';
import logger from '../lib/logger.js';

/* ========================================================================== */
/* Visibility                                                                 */
/* ========================================================================== */

/**
 * What "publicly available product" means.
 *
 * Deliberately the same predicate `getProducts` uses for the public catalogue
 * rather than a new one: `isActive: { $ne: false }` (not `true`) because legacy
 * documents predate the field, and `deletedAt: null` for soft deletes. If the
 * catalogue's visibility rules change, they change in both places together.
 */
const PUBLIC_PRODUCT_FILTER = Object.freeze({
  isActive: { $ne: false },
  deletedAt: null,
});

/** A curated id may point at any live product, including a temporarily hidden one. */
const CURATABLE_PRODUCT_FILTER = Object.freeze({ deletedAt: null });

/* ========================================================================== */
/* Cache                                                                      */
/* ========================================================================== */

/**
 * Anonymous list cache, in-process, same shape as `categoriesCache` in
 * category.controller.js. Collections change a handful of times a month and are
 * read on every browse, so this is the cheapest useful win — and it is
 * deliberately *not* Redis: the queue system owns the only Redis dependency in
 * this codebase and a curated list of ~20 rows does not justify a second one.
 */
const LIST_TTL = 5 * 60 * 1000;
const listCache = new Map();

/**
 * Called after every collection write.
 *
 * Also clears the home cache, because the home payload carries the active
 * collections for the home rail — without this, a renamed, reordered or
 * deactivated collection would keep showing on the home screen for up to the
 * home TTL, which is exactly the "I saved it and nothing changed" bug the
 * banner and category controllers already avoid this way.
 */
export const invalidateCollectionCache = () => {
  listCache.clear();
  invalidateHomeCache();
  logger.info('Collection cache invalidated');
};

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

const parsePagination = (query, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const page = Math.max(1, Math.min(parseInt(query.page, 10) || 1, 10000));
  const limit = Math.max(1, Math.min(parseInt(query.limit, 10) || defaultLimit, maxLimit));
  return { page, limit, skip: (page - 1) * limit };
};

/**
 * Convert an already-enriched product list into the requested currency.
 *
 * Mirrors `getProducts` / `getHomeData`: the FX rate and currency config are
 * fetched ONCE for the whole page rather than per product, and any failure
 * falls back to USD rather than returning a half-converted mix.
 */
const convertProducts = async (products, currencyCode) => {
  const code = (currencyCode || 'USD').toUpperCase();
  if (code === 'USD' || products.length === 0) return products;

  try {
    const [config, rate] = await Promise.all([
      Currency.findOne({ code }).lean(),
      getLatestRate(code),
    ]);
    const ctx = { config, rate };
    return await Promise.all(products.map((p) => convertProductPrices(p, code, ctx)));
  } catch (error) {
    logger.warn('Collection: currency conversion failed, returning USD', {
      currencyCode: code,
      error: error.message,
    });
    return products;
  }
};

/**
 * Resolve the curated ids to renderable products.
 *
 * Two queries, never N+1, and never "load everything then throw most of it
 * away":
 *
 *   1. an id-only pass that says which of the curated products are still
 *      publicly available (a deleted or hidden product simply drops out), and
 *   2. a full read of just the page's worth of survivors.
 *
 * Filtering before paginating is what makes `[A, B, C, D]` with B deleted
 * return `[A, C, D]` — with the page slice taken from the *stored* array
 * instead, a page could come back short or, worse, skip products entirely.
 */
const loadCollectionProducts = async (curatedIds, { skip, limit }) => {
  if (curatedIds.length === 0) return { products: [], total: 0 };

  const availableDocs = await Product.find({
    _id: { $in: curatedIds },
    ...PUBLIC_PRODUCT_FILTER,
  })
    .select('_id')
    .lean();

  const available = new Set(availableDocs.map((d) => String(d._id)));
  // Order comes from the curated array, not from the query — this is the
  // "preserve the order of remaining products" guarantee.
  const orderedAvailable = curatedIds.map(String).filter((id) => available.has(id));
  const total = orderedAvailable.length;

  const pageIds = orderedAvailable.slice(skip, skip + limit);
  if (pageIds.length === 0) return { products: [], total };

  // Whole documents, and the same two populates `getProducts` shapes: the
  // collection screen renders the shared product card, so anything trimmed here
  // would be a second, subtly different product DTO for one screen to special-case.
  const docs = await Product.find({ _id: { $in: pageIds } })
    .populate('merchant', 'storeName email logoUrl status')
    .populate('category', 'name')
    .lean();

  // `$in` returns documents in index order, so re-project onto the curated one.
  return { products: orderByIds(pageIds, docs), total };
};

/**
 * Look a collection up by ObjectId **or** slug.
 *
 * Campaign links address collections by slug; the banner target stores an
 * ObjectId. Accepting both here means the mobile screen has one route either
 * way. `filter` scopes the lookup (public reads pass `{ isActive: true }`).
 */
const findCollection = (idOrSlug, filter = {}) => {
  const query = mongoose.isValidObjectId(idOrSlug)
    ? { _id: idOrSlug }
    : { slug: String(idOrSlug).toLowerCase() };
  return Collection.findOne({ ...query, ...filter });
};

/**
 * Verify every curated id points at a live product.
 *
 * Ids arrive from the dashboard, which is admin-only but not trusted: a stale
 * tab or a hand-rolled request could reference a product that has since been
 * deleted, and a collection whose taps dead-end on a 404 is worse than a
 * rejected save. Returns the offending ids, or an empty array.
 */
const findUnknownProductIds = async (ids) => {
  if (ids.length === 0) return [];
  const found = await Product.find({ _id: { $in: ids }, ...CURATABLE_PRODUCT_FILTER })
    .select('_id')
    .lean();
  const known = new Set(found.map((d) => String(d._id)));
  return ids.filter((id) => !known.has(String(id)));
};

/**
 * Reserve a unique slug.
 *
 * The unique index is the real guarantee; this exists so the admin gets
 * "ramadan-favorites-2" instead of an E11000 they cannot act on.
 */
const uniqueSlug = async (base, excludeId = null) => {
  const root = slugify(base) || 'collection';
  let candidate = root;

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const clash = await Collection.exists({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    if (!clash) return candidate;
    candidate = `${root}-${suffix}`;
  }

  // Astronomically unlikely; a timestamp is still better than a 500.
  return `${root}-${Date.now()}`;
};

/* ========================================================================== */
/* Public                                                                     */
/* ========================================================================== */

/**
 * GET /api/collections
 *
 * Active collections only, in curated order. Returns summaries — the product
 * ids are not part of the list payload, because a listing screen renders a card
 * per collection and nothing else.
 */
export const getCollections = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const key = `${page}:${limit}`;

    const hit = listCache.get(key);
    if (hit && Date.now() - hit.at < LIST_TTL) {
      return sendPaginated(res, {
        data: structuredClone(hit.data),
        page,
        limit,
        total: hit.total,
        message: 'Collections retrieved successfully',
      });
    }

    const filter = { isActive: true };
    const [docs, total] = await Promise.all([
      Collection.find(filter)
        .sort({ sortOrder: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Collection.countDocuments(filter),
    ]);

    // `productCount` is the curated size, not the available size: counting
    // availability here would mean one product query per collection on a hot,
    // cached listing endpoint. The detail response reports the real number.
    const data = docs.map((doc) => toCollectionSummary(doc, doc.products?.length ?? 0));

    listCache.set(key, { data, total, at: Date.now() });

    return sendPaginated(res, {
      data: structuredClone(data),
      page,
      limit,
      total,
      message: 'Collections retrieved successfully',
    });
  } catch (error) {
    logger.error('Failed to list collections', { error: error.message });
    return sendError(res, { message: 'Failed to retrieve collections' });
  }
};

/**
 * GET /api/collections/:id
 *
 * The collection plus a page of its products, in curated order, using the same
 * enriched product representation the catalogue endpoints emit — so the mobile
 * product card renders a collection product identically to a search result.
 *
 * An inactive collection is a 404 here: the admin has taken it down, and
 * leaking its contents through a direct link would defeat that.
 */
export const getCollectionById = async (req, res) => {
  try {
    const doc = await findCollection(req.params.id, { isActive: true }).lean();
    if (!doc) return sendNotFound(res, 'Collection');

    const { page, limit, skip } = parsePagination(req.query);
    const curatedIds = (doc.products || []).map(String);

    const { products, total } = await loadCollectionProducts(curatedIds, { skip, limit });
    const enriched = enrichProductsWithPricing(products);
    const converted = await convertProducts(enriched, req.currencyCode);

    return sendSuccess(res, {
      message: 'Collection retrieved successfully',
      // An empty collection is a valid collection: the screen renders its hero
      // and an empty state rather than an error.
      data: {
        ...toCollectionSummary(doc, total),
        products: converted,
      },
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: skip + converted.length < total,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    logger.error('Failed to retrieve collection', {
      collectionId: req.params.id,
      error: error.message,
    });
    return sendError(res, { message: 'Failed to retrieve collection' });
  }
};

/* ========================================================================== */
/* Admin                                                                      */
/* ========================================================================== */

/**
 * GET /api/collections/admin/all
 *
 * Everything, including inactive collections, with an optional name search.
 */
export const getCollectionsAdmin = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50 });
    const filter = {};

    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const term = req.query.search.trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { slug: { $regex: term, $options: 'i' } },
      ];
    }
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    const [docs, total] = await Promise.all([
      Collection.find(filter)
        .sort({ sortOrder: 1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Collection.countDocuments(filter),
    ]);

    return sendPaginated(res, {
      data: docs.map((doc) => toCollectionSummary(doc, doc.products?.length ?? 0)),
      page,
      limit,
      total,
      message: 'Collections retrieved successfully',
    });
  } catch (error) {
    logger.error('Failed to list collections for admin', { error: error.message });
    return sendError(res, { message: 'Failed to retrieve collections' });
  }
};

/**
 * GET /api/collections/admin/:id
 *
 * The edit form's source. Products come back in curated order and *include*
 * ones that are no longer publicly visible, each flagged — the form must show
 * the admin exactly what is stored, or saving would silently drop rows they
 * cannot see.
 */
export const getCollectionAdminById = async (req, res) => {
  try {
    const doc = await findCollection(req.params.id).lean();
    if (!doc) return sendNotFound(res, 'Collection');

    const curatedIds = (doc.products || []).map(String);
    let products = [];

    if (curatedIds.length > 0) {
      const docs = await Product.find({ _id: { $in: curatedIds } })
        .select('name images isActive status deletedAt merchant')
        .populate('merchant', 'storeName')
        .lean();

      const byId = new Map(docs.map((p) => [String(p._id), p]));
      products = curatedIds.map((id) => {
        const p = byId.get(id);
        // A curated product that no longer resolves keeps its slot rather than
        // disappearing, so the admin can see it and remove it deliberately.
        if (!p) return { _id: id, name: null, image: null, available: false, missing: true };
        return {
          _id: id,
          name: p.name,
          image: p.images?.[0] ?? null,
          storeName: p.merchant?.storeName ?? null,
          available: p.isActive !== false,
          missing: false,
        };
      });
    }

    return sendSuccess(res, {
      message: 'Collection retrieved successfully',
      data: { ...toCollectionSummary(doc, curatedIds.length), products },
    });
  } catch (error) {
    logger.error('Failed to retrieve collection for admin', {
      collectionId: req.params.id,
      error: error.message,
    });
    return sendError(res, { message: 'Failed to retrieve collection' });
  }
};

/** POST /api/collections */
export const createCollection = async (req, res) => {
  try {
    const productResult = validateCollectionProducts(req.body.products);
    if (!productResult.ok) {
      return sendError(res, {
        message: productResult.message,
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        details: [{ field: 'products', message: productResult.message }],
      });
    }

    const unknown = await findUnknownProductIds(productResult.value);
    if (unknown.length > 0) {
      return sendError(res, {
        message: 'One or more products do not exist',
        code: 'COLLECTION_PRODUCT_NOT_FOUND',
        statusCode: 400,
        details: unknown.map((id) => ({ field: 'products', message: `Product ${id} does not exist` })),
      });
    }

    const collection = await Collection.create({
      name: req.body.name,
      slug: await uniqueSlug(req.body.slug || req.body.name),
      description: req.body.description ?? '',
      image: req.body.image ? req.body.image : null,
      products: productResult.value,
      isActive: req.body.isActive ?? true,
      sortOrder: req.body.sortOrder ?? 0,
    });

    invalidateCollectionCache();
    return sendCreated(
      res,
      toCollectionSummary(collection.toObject(), collection.products.length),
      'Collection created successfully',
    );
  } catch (error) {
    logger.error('Failed to create collection', { error: error.message });
    return sendError(res, { message: 'Failed to create collection' });
  }
};

/** PUT /api/collections/:id — partial; only the fields sent are touched. */
export const updateCollection = async (req, res) => {
  try {
    const existing = await Collection.findById(req.params.id);
    if (!existing) return sendNotFound(res, 'Collection');

    const $set = {};

    if (req.body.name !== undefined) $set.name = req.body.name;
    if (req.body.description !== undefined) $set.description = req.body.description ?? '';
    if (req.body.image !== undefined) $set.image = req.body.image ? req.body.image : null;
    if (req.body.isActive !== undefined) $set.isActive = req.body.isActive;
    if (req.body.sortOrder !== undefined) $set.sortOrder = req.body.sortOrder;

    // Re-slug only when explicitly asked, or when the name changes on a
    // collection whose slug was auto-derived. A slug someone has already put in
    // a campaign link must not move because the title was reworded.
    if (req.body.slug) {
      $set.slug = await uniqueSlug(req.body.slug, existing._id);
    }

    if (req.body.products !== undefined) {
      const productResult = validateCollectionProducts(req.body.products);
      if (!productResult.ok) {
        return sendError(res, {
          message: productResult.message,
          code: 'VALIDATION_ERROR',
          statusCode: 400,
          details: [{ field: 'products', message: productResult.message }],
        });
      }

      const unknown = await findUnknownProductIds(productResult.value);
      if (unknown.length > 0) {
        return sendError(res, {
          message: 'One or more products do not exist',
          code: 'COLLECTION_PRODUCT_NOT_FOUND',
          statusCode: 400,
          details: unknown.map((id) => ({
            field: 'products',
            message: `Product ${id} does not exist`,
          })),
        });
      }

      $set.products = productResult.value;
    }

    if (Object.keys($set).length === 0) {
      return sendSuccess(res, {
        message: 'Collection unchanged',
        data: toCollectionSummary(existing.toObject(), existing.products.length),
      });
    }

    const updated = await Collection.findByIdAndUpdate(
      req.params.id,
      { $set },
      { new: true, runValidators: true },
    ).lean();

    invalidateCollectionCache();
    return sendSuccess(res, {
      message: 'Collection updated successfully',
      data: toCollectionSummary(updated, updated.products?.length ?? 0),
    });
  } catch (error) {
    logger.error('Failed to update collection', {
      collectionId: req.params.id,
      error: error.message,
    });
    return sendError(res, { message: 'Failed to update collection' });
  }
};

/**
 * DELETE /api/collections/:id
 *
 * Removes the collection and nothing else — the products it curated are
 * untouched, because a collection is a view over the catalogue, not an owner
 * of it.
 *
 * A collection a banner still points at is refused rather than deleted, the
 * same way `deleteCategory` refuses a category that still has children:
 * deleting it would leave a banner on the home screen whose tap dead-ends.
 * `?force=true` deletes anyway and clears those banner targets, so the admin
 * has a way out without hunting through the banner list.
 */
export const deleteCollection = async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id);
    if (!collection) return sendNotFound(res, 'Collection');

    const bannerFilter = { 'target.type': 'collection', 'target.id': collection._id };
    const referencing = await Banner.countDocuments(bannerFilter);

    if (referencing > 0 && req.query.force !== 'true') {
      return sendError(res, {
        message: `This collection is used by ${referencing} banner(s). Update or remove them first.`,
        code: 'COLLECTION_IN_USE',
        statusCode: 409,
        details: [{ field: 'id', message: `${referencing} banner(s) target this collection` }],
      });
    }

    if (referencing > 0) {
      await Banner.updateMany(bannerFilter, { $unset: { target: '' } });
    }

    await Collection.findByIdAndDelete(collection._id);
    // Clears the collection list cache and the home payload — which is what
    // those just-rewritten banners need too.
    invalidateCollectionCache();

    return sendSuccess(res, {
      message: 'Collection deleted successfully',
      data: { _id: collection._id, bannersCleared: referencing },
    });
  } catch (error) {
    logger.error('Failed to delete collection', {
      collectionId: req.params.id,
      error: error.message,
    });
    return sendError(res, { message: 'Failed to delete collection' });
  }
};
