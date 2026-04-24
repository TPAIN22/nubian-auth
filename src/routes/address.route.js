import express from 'express';
import { getAddresses, addAddress, updateAddress, deleteAddress, setDefaultAddress } from '../controllers/address.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';
import { validateObjectId, handleValidationErrors } from '../middleware/validation.middleware.js';

const router = express.Router();

router.get('/',  isAuthenticated, getAddresses);
router.post('/', isAuthenticated, addAddress);

router.put('/:id',           isAuthenticated, ...validateObjectId('id'), handleValidationErrors, updateAddress);
router.delete('/:id',        isAuthenticated, ...validateObjectId('id'), handleValidationErrors, deleteAddress);
router.patch('/:id/default', isAuthenticated, ...validateObjectId('id'), handleValidationErrors, setDefaultAddress);

export default router;
