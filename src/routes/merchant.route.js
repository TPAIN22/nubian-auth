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
import {
  listMembers,
  listMyMemberships,
  inviteMember,
  acceptInvite,
  updateMemberRole,
  removeMember,
  transferOwnership,
} from '../controllers/merchantTeam.controller.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import { isMerchant, isApprovedMerchant, requireMerchantPermission } from '../middleware/merchant.middleware.js';
import { PERMISSIONS } from '../lib/merchantPermissions.js';
import { validateMerchantApplication, validateMerchantUpdate, validateMerchantStatusUpdate, validateMerchantSuspension, validateAdminStoreCreate, validateAdminStoreUpdate, validateStoreLink, validateTeamInvite, validateTeamRoleUpdate, validateOwnershipTransfer, validateInviteAccept } from '../middleware/validators/merchant.validator.js';
import { validateObjectId, handleValidationErrors } from '../middleware/validation.middleware.js';

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
router.put('/my-profile', isAuthenticated, isApprovedMerchant, requireMerchantPermission(PERMISSIONS.PROFILE_WRITE), validateMerchantUpdate, updateMerchantProfile);

// ── Team management ─────────────────────────────────────────────────────
// All declared before '/:id' so these literal paths are not swallowed by the
// ObjectId param route.

// Which stores the caller belongs to, plus invitations waiting for them.
// Authenticated-only on purpose: requiring a membership would make an invite
// impossible to discover in-app.
router.get('/my-memberships', isAuthenticated, listMyMemberships);

// Accepting an invitation cannot be gated on membership — the accepting user is
// not a member yet. That is the whole point of the endpoint.
router.post('/members/accept', isAuthenticated, validateInviteAccept, acceptInvite);

// Reading the team is open to any member; changing it is owner-only via team:write.
router.get('/my-store/members', isAuthenticated, isApprovedMerchant, listMembers);
router.post('/my-store/members', isAuthenticated, isApprovedMerchant, requireMerchantPermission(PERMISSIONS.TEAM_WRITE), validateTeamInvite, inviteMember);
router.patch('/my-store/members/:memberId', isAuthenticated, isApprovedMerchant, requireMerchantPermission(PERMISSIONS.TEAM_WRITE), ...validateObjectId('memberId'), validateTeamRoleUpdate, updateMemberRole);
// handleValidationErrors is explicit here: validateObjectId only queues the
// check, and every other route on this path gets the handler from the body
// validator that follows it. Without it a malformed id reaches the controller
// and surfaces as a 500 CastError instead of a 400.
router.delete('/my-store/members/:memberId', isAuthenticated, isApprovedMerchant, requireMerchantPermission(PERMISSIONS.TEAM_WRITE), ...validateObjectId('memberId'), handleValidationErrors, removeMember);
router.post('/my-store/transfer-ownership', isAuthenticated, isApprovedMerchant, requireMerchantPermission(PERMISSIONS.TEAM_WRITE), validateOwnershipTransfer, transferOwnership);

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

