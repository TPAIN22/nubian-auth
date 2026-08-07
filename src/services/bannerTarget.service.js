import mongoose from 'mongoose';
import Merchant from '../models/merchant.model.js';
import Product from '../models/product.model.js';
import Category from '../models/categories.model.js';
import Collection from '../models/collection.model.js';
import { ServiceError } from '../lib/errors.js';
import {
  BANNER_TARGET_TYPES_UNSUPPORTED,
  normalizeBannerTarget,
} from '../lib/bannerTarget.js';

/**
 * Resolvers for entity-backed banner targets.
 *
 * One entry per target type that references a document. A type absent from this
 * map has no destination to verify (`none`, `url`) or is not implemented yet
 * (see BANNER_TARGET_TYPES_UNSUPPORTED — currently empty).
 */
const RESOLVERS = {
  // "Store" is a Merchant document — the platform has no separate Store model.
  store: {
    label: 'Store',
    exists: (id) => Merchant.exists({ _id: id }),
  },
  product: {
    label: 'Product',
    exists: (id) => Product.exists({ _id: id, deletedAt: null }),
  },
  category: {
    label: 'Category',
    exists: (id) => Category.exists({ _id: id }),
  },
  /**
   * The only resolver that also checks a visibility flag.
   *
   * The public collection endpoint serves active collections only, so a banner
   * pointing at an inactive one would render on the home screen and dead-end on
   * a 404. The others have no equivalent trap: a hidden product or an
   * unapproved store still has a screen that renders something sensible.
   */
  collection: {
    label: 'Collection',
    exists: (id) => Collection.exists({ _id: id, isActive: true }),
    missingMessage: (id) =>
      `Collection ${id} does not exist or is not active`,
  },
};

/**
 * Verify that an already-shape-validated target actually points at something.
 *
 * Shape validation (`lib/bannerTarget.js`, run in the validator middleware)
 * guarantees the type/id/url combination is legal. This adds the part that
 * needs the database: that the referenced document exists, so an admin cannot
 * publish a banner to the whole home screen that dead-ends on a 404.
 *
 * @param {object|undefined|null} rawTarget - target as sent by the client
 * @returns {Promise<object>} the canonical target to persist
 * @throws {ServiceError} when the type is unsupported or the entity is missing
 */
export const resolveBannerTarget = async (rawTarget) => {
  const target = normalizeBannerTarget(rawTarget);

  if (target.type === 'none' || target.type === 'url') return target;

  if (BANNER_TARGET_TYPES_UNSUPPORTED.includes(target.type)) {
    throw new ServiceError(
      `Banner targets of type "${target.type}" are not available yet`,
      'BANNER_TARGET_TYPE_UNSUPPORTED',
      400,
    );
  }

  const resolver = RESOLVERS[target.type];
  if (!resolver) {
    throw new ServiceError(
      `Unknown banner target type "${target.type}"`,
      'BANNER_TARGET_TYPE_UNKNOWN',
      400,
    );
  }

  const found = await resolver.exists(new mongoose.Types.ObjectId(target.id));
  if (!found) {
    const detail = resolver.missingMessage
      ? resolver.missingMessage(target.id)
      : `${resolver.label} ${target.id} does not exist`;
    throw new ServiceError(
      `${resolver.label} not found for banner target`,
      'BANNER_TARGET_NOT_FOUND',
      404,
      [{ field: 'target.id', message: detail }],
    );
  }

  return target;
};
