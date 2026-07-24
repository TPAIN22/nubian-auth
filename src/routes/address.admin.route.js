import express from 'express';
import {
  getAddressById,
  getAddressStats,
  listAddresses,
} from '../controllers/address.admin.controller.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import { handleValidationErrors, validateObjectId } from '../middleware/validation.middleware.js';
import { validateAdminAddressList } from '../middleware/validators/address.validator.js';

const router = express.Router();

router.use(isAuthenticated, isAdmin);

// Mounted before /:id so "stats" is never parsed as an ObjectId.
router.get('/stats', getAddressStats);

router.get('/', validateAdminAddressList, handleValidationErrors, listAddresses);

router.get('/:id', ...validateObjectId('id'), handleValidationErrors, getAddressById);

export default router;
