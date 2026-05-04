import express from 'express';
import { getAddresses, addAddress, updateAddress, deleteAddress, setDefaultAddress } from '../controllers/address.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import { requireUser } from '../middleware/requireUser.middleware.js';
import { validateObjectId, handleValidationErrors } from '../middleware/validation.middleware.js';

const router = express.Router();

router.get('/',  isAuthenticated, requireUser, getAddresses);
router.post('/', isAuthenticated, requireUser, addAddress);

router.put('/:id',           isAuthenticated, requireUser, ...validateObjectId('id'), handleValidationErrors, updateAddress);
router.delete('/:id',        isAuthenticated, requireUser, ...validateObjectId('id'), handleValidationErrors, deleteAddress);
router.patch('/:id/default', isAuthenticated, requireUser, ...validateObjectId('id'), handleValidationErrors, setDefaultAddress);

export default router;
