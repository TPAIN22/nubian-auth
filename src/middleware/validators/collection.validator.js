import { body } from 'express-validator';
import {
  COLLECTION_DESCRIPTION_MAX,
  COLLECTION_NAME_MAX,
  COLLECTION_NAME_MIN,
  COLLECTION_SLUG_MAX,
  COLLECTION_SORT_ORDER_MAX,
  COLLECTION_SORT_ORDER_MIN,
  SLUG_RE,
  validateCollectionProducts,
} from '../../lib/collection.js';

/**
 * Collection write validation.
 *
 * Shape only — "does product X exist and is it visible" needs the database and
 * belongs to the controller. Everything that can be decided from the payload
 * alone is decided here, so the client gets the standard VALIDATION_ERROR
 * envelope with a field path instead of a Mongoose cast error.
 */

const name = (chain) =>
  chain
    .trim()
    .notEmpty()
    .withMessage('name is required')
    .isLength({ min: COLLECTION_NAME_MIN, max: COLLECTION_NAME_MAX })
    .withMessage(
      `name must be between ${COLLECTION_NAME_MIN} and ${COLLECTION_NAME_MAX} characters`,
    );

const description = body('description')
  .optional({ nullable: true })
  .trim()
  .isLength({ max: COLLECTION_DESCRIPTION_MAX })
  .withMessage(`description must be at most ${COLLECTION_DESCRIPTION_MAX} characters`);

/**
 * Optional: an empty string clears the image, which is why this cannot just be
 * `.isURL()` — the dashboard blanks the field to remove the picture.
 */
const image = body('image')
  .optional({ nullable: true })
  .trim()
  .custom((value) => {
    if (value === '') return true;
    // Same rule as the banner image: absolute http(s) only.
    if (!/^https?:\/\/\S+$/i.test(value)) {
      throw new Error('image must be an absolute http(s) URL');
    }
    return true;
  });

/**
 * Slugs are normally generated from the name; an explicit one is accepted so a
 * campaign can pin a link. Unicode letters are legal — see `slugify`.
 */
const slug = body('slug')
  .optional({ nullable: true })
  .trim()
  .toLowerCase()
  .custom((value) => {
    if (value === '') return true;
    if (value.length > COLLECTION_SLUG_MAX) {
      throw new Error(`slug must be at most ${COLLECTION_SLUG_MAX} characters`);
    }
    // ASCII slugs must look like slugs; anything containing non-ASCII letters is
    // checked only for the separators, since \w-style classes are ASCII-only.
    const asciiOnly = /^[\x20-\x7E]*$/.test(value);
    if (asciiOnly && !SLUG_RE.test(value)) {
      throw new Error('slug must be lowercase words separated by single hyphens');
    }
    if (/\s/.test(value)) throw new Error('slug must not contain spaces');
    return true;
  });

const sortOrder = body('sortOrder')
  .optional()
  .isInt({ min: COLLECTION_SORT_ORDER_MIN, max: COLLECTION_SORT_ORDER_MAX })
  .withMessage('sortOrder must be a non-negative integer')
  .toInt();

const isActive = body('isActive')
  .optional()
  .isBoolean()
  .withMessage('isActive must be a boolean')
  .toBoolean();

/**
 * Ordered product list, delegated wholesale to `lib/collection.js` so the
 * duplicate/limit/ObjectId rules exist in exactly one place.
 *
 * The sanitiser replaces the submitted array with the canonical one — this is
 * what unwraps `{ _id }` option objects from the dashboard picker and trims the
 * ids, so the controller can use `req.body.products` directly. It deliberately
 * does NOT de-duplicate: a duplicate is rejected above, because silently
 * collapsing it would renumber the sequence the admin just arranged.
 */
const products = body('products')
  .optional({ nullable: true })
  .custom((value) => {
    const result = validateCollectionProducts(value);
    if (!result.ok) throw new Error(result.message);
    return true;
  })
  .customSanitizer((value) => {
    const result = validateCollectionProducts(value);
    return result.ok ? result.value : value;
  });

export const validateCollectionCreate = [
  name(body('name')),
  description,
  image,
  slug,
  sortOrder,
  isActive,
  products,
];

/**
 * Update is a partial: toggling `isActive` must not require resending the whole
 * product list. Every field is still fully validated whenever it is present.
 */
export const validateCollectionUpdate = [
  name(body('name').optional()),
  description,
  image,
  slug,
  sortOrder,
  isActive,
  products,
];
