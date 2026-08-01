import express from 'express';
import {
  applyToBecomeMerchant,
  withdrawMyApplication,
  merchantDiagnostic,
  getMyMerchantStatus,
  getAllMerchants,
  getMerchantById,
  getStoreById,
  getStoreProducts,
  getStoreReviews,
  approveMerchant,
  rejectMerchant,
  requestMerchantRevision,
  suspendMerchant,
  unsuspendMerchant,
  deleteMerchant,
  purgeMerchantByClerkId,
  getMyMerchantProfile,
  updateMerchantProfile,
  getPublicMerchants,
  freezeMerchant,
  createStoreForMerchant,
  updateStoreForMerchant,
  getStoreClaimCandidates,
  linkStoreToUser,
} from '../controllers/merchant.controller.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import { isMerchant, isApprovedMerchant } from '../middleware/merchant.middleware.js';
import { validateMerchantApplication, validateMerchantUpdate, validateMerchantStatusUpdate, validateMerchantSuspension, validateAdminStoreCreate, validateAdminStoreUpdate, validateStoreLink } from '../middleware/validators/merchant.validator.js';
import { validateObjectId } from '../middleware/validation.middleware.js';

const router = express.Router();

// Public routes (authenticated users can apply)
router.post('/apply', isAuthenticated, validateMerchantApplication, applyToBecomeMerchant);
router.delete('/my-application', isAuthenticated, withdrawMyApplication);
router.get('/my-status', isAuthenticated, getMyMerchantStatus);
router.get('/_diag', isAuthenticated, merchantDiagnostic);
router.get('/list', getPublicMerchants); // New Public Endpoint

// Public store routes (authenticated users can view approved stores)
router.get('/store/:id', getStoreById);
router.get('/store/:id/products', getStoreProducts);
router.get('/store/:id/reviews', getStoreReviews);

// Merchant-only routes (approved merchants)
router.get('/me', isAuthenticated, isApprovedMerchant, getMyMerchantProfile); // Alias for /my-profile
router.get('/my-profile', isAuthenticated, isApprovedMerchant, getMyMerchantProfile);
router.put('/my-profile', isAuthenticated, isApprovedMerchant, validateMerchantUpdate, updateMerchantProfile);

// Admin-only routes
router.get('/', isAuthenticated, isAdmin, getAllMerchants);

// Admin-created stores. Registered before '/:id' so the literal path is not
// swallowed by the ObjectId param route.
router.post('/admin/stores', isAuthenticated, isAdmin, validateAdminStoreCreate, createStoreForMerchant);
router.patch('/admin/stores/:id', isAuthenticated, isAdmin, ...validateObjectId('id'), validateAdminStoreUpdate, updateStoreForMerchant);

router.get('/:id', isAuthenticated, isAdmin, ...validateObjectId('id'), getMerchantById);
router.get('/:id/claim-candidates', isAuthenticated, isAdmin, ...validateObjectId('id'), getStoreClaimCandidates);
router.post('/:id/link-user', isAuthenticated, isAdmin, ...validateObjectId('id'), validateStoreLink, linkStoreToUser);
router.patch('/:id/approve', isAuthenticated, isAdmin, ...validateObjectId('id'), approveMerchant);
router.patch('/:id/reject', isAuthenticated, isAdmin, ...validateObjectId('id'), validateMerchantStatusUpdate, rejectMerchant);
router.patch('/:id/request-revision', isAuthenticated, isAdmin, ...validateObjectId('id'), requestMerchantRevision);
router.patch('/:id/suspend', isAuthenticated, isAdmin, ...validateObjectId('id'), validateMerchantSuspension, suspendMerchant);
router.patch('/:id/unsuspend', isAuthenticated, isAdmin, ...validateObjectId('id'), unsuspendMerchant);
router.post('/:id/freeze', isAuthenticated, isAdmin, ...validateObjectId('id'), freezeMerchant);
router.delete('/:id', isAuthenticated, isAdmin, ...validateObjectId('id'), deleteMerchant);

// Recovery: purge orphan merchant trail by Clerk userId. Used when the user
// was removed manually or the user.deleted webhook failed and a stale Merchant
// row is blocking re-application. Idempotent.
router.delete('/admin/purge/:clerkId', isAuthenticated, isAdmin, purgeMerchantByClerkId);

export default router;

