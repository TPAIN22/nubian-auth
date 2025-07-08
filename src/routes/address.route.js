import express from 'express';
import { getAddresses, addAddress, updateAddress, deleteAddress, setDefaultAddress } from '../controllers/address.controller.js';
import { isAuthenticated } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', isAuthenticated, getAddresses);
router.post('/', isAuthenticated, addAddress);
router.put('/:id', isAuthenticated, updateAddress);
router.delete('/:id', isAuthenticated, deleteAddress);
router.patch('/:id/default', isAuthenticated, setDefaultAddress);

export default router; 