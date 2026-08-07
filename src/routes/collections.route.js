import express from 'express';

import {
  getCollections,
  getCollectionById,
  getCollectionsAdmin,
  getCollectionAdminById,
  createCollection,
  updateCollection,
  deleteCollection,
} from '../controllers/collection.controller.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import {
  handleValidationErrors,
  validateObjectId,
  validatePagination,
} from '../middleware/validation.middleware.js';
import {
  validateCollectionCreate,
  validateCollectionUpdate,
} from '../middleware/validators/collection.validator.js';

const router = express.Router();

/* -- Admin ---------------------------------------------------------------- */
// Declared before `/:id` so "admin" is never swallowed by the public detail
// route — the same ordering rule `products.route.js` follows for /admin/all.
router.get('/admin/all', isAuthenticated, isAdmin, validatePagination, handleValidationErrors, getCollectionsAdmin);
router.get(
  '/admin/:id',
  isAuthenticated,
  isAdmin,
  ...validateObjectId('id'),
  handleValidationErrors,
  getCollectionAdminById,
);

router.post(
  '/',
  isAuthenticated,
  isAdmin,
  validateCollectionCreate,
  handleValidationErrors,
  createCollection,
);
router.put(
  '/:id',
  isAuthenticated,
  isAdmin,
  ...validateObjectId('id'),
  validateCollectionUpdate,
  handleValidationErrors,
  updateCollection,
);
router.delete(
  '/:id',
  isAuthenticated,
  isAdmin,
  ...validateObjectId('id'),
  handleValidationErrors,
  deleteCollection,
);

/* -- Public --------------------------------------------------------------- */
router.get('/', validatePagination, handleValidationErrors, getCollections);
// `:id` accepts an ObjectId or a slug, so it is intentionally not run through
// validateObjectId — the controller decides which lookup applies.
router.get('/:id', validatePagination, handleValidationErrors, getCollectionById);

export default router;
