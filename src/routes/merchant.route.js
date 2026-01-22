import express from 'express';
import {
  applyToBecomeMerchant,
  getMyMerchantStatus,
  getAllMerchants,
  getMerchantById,
  getStoreById,
  getStoreProducts,
  approveMerchant,
  rejectMerchant,
  suspendMerchant,
  unsuspendMerchant,
  deleteMerchant,
  getMyMerchantProfile,
  updateMerchantProfile,
} from '../controllers/merchant.controller.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import { isMerchant, isApprovedMerchant } from '../middleware/merchant.middleware.js';
import { validateMerchantApplication, validateMerchantUpdate, validateMerchantStatusUpdate, validateMerchantSuspension } from '../middleware/validators/merchant.validator.js';
import { validateObjectId } from '../middleware/validation.middleware.js';

const router = express.Router();

// Public routes (authenticated users can apply)
router.post('/apply', isAuthenticated, validateMerchantApplication, applyToBecomeMerchant);
router.get('/my-status', isAuthenticated, getMyMerchantStatus);

// Public store routes (authenticated users can view approved stores)
router.get('/store/:id', getStoreById);
router.get('/store/:id/products', getStoreProducts);

// Merchant-only routes (approved merchants)
router.get('/me', isAuthenticated, isApprovedMerchant, getMyMerchantProfile); // Alias for /my-profile
router.get('/my-profile', isAuthenticated, isApprovedMerchant, getMyMerchantProfile);
router.put('/my-profile', isAuthenticated, isApprovedMerchant, validateMerchantUpdate, updateMerchantProfile);

// Admin-only routes
router.get('/', isAuthenticated, isAdmin, getAllMerchants);
router.get('/:id', isAuthenticated, isAdmin, ...validateObjectId('id'), getMerchantById);
router.patch('/:id/approve', isAuthenticated, isAdmin, ...validateObjectId('id'), approveMerchant);
router.patch('/:id/reject', isAuthenticated, isAdmin, ...validateObjectId('id'), validateMerchantStatusUpdate, rejectMerchant);
router.patch('/:id/suspend', isAuthenticated, isAdmin, ...validateObjectId('id'), validateMerchantSuspension, suspendMerchant);
router.patch('/:id/unsuspend', isAuthenticated, isAdmin, ...validateObjectId('id'), unsuspendMerchant);
router.delete('/:id', isAuthenticated, isAdmin, ...validateObjectId('id'), deleteMerchant);

export default router;

