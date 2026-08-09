import { clerkClient } from '@clerk/express';
import mongoose from 'mongoose';
import Merchant from '../models/merchant.model.js';
import MerchantMember from '../models/merchantMember.model.js';
import { hasPermission, permissionsForRole } from '../lib/merchantPermissions.js';
import logger from '../lib/logger.js';

// Header a client sends to say which of its stores it is acting for. Only
// consulted when the caller belongs to more than one store; a single-store
// merchant never has to send it, which is why nothing existing had to change.
const ACTIVE_STORE_HEADER = 'x-merchant-id';

/**
 * Resolve which store the caller is acting for, and with what role.
 *
 * Returns either `{ merchant, membership }` or `{ error }`, where `error` is a
 * ready-to-send `{ statusCode, body }` pair. Middlewares below decide whether a
 * given store status is acceptable — this only answers "which store, and may
 * this user touch it at all".
 *
 * @param {string} userId - Clerk userId
 * @param {string|undefined} requestedMerchantId - value of the x-merchant-id header
 */
const resolveMerchantContext = async (userId, requestedMerchantId) => {
  const memberships = await MerchantMember.find({
    userId,
    status: 'active',
  }).lean();

  // Legacy path: stores that predate MerchantMember still carry their owner in
  // Merchant.userId. Backfill creates the owner rows; this keeps requests
  // working in the window before it has run, and on any row it missed. Watch
  // for `legacyOwnerFallback` in the logs — once it stops appearing, this
  // branch and the unique index on Merchant.userId can both go.
  if (memberships.length === 0) {
    const merchant = await Merchant.findOne({ userId });
    if (!merchant) {
      return {
        error: {
          statusCode: 403,
          body: { message: 'Merchant profile not found', code: 'MERCHANT_NOT_FOUND' },
        },
      };
    }

    logger.info('Merchant resolved via legacyOwnerFallback', {
      userId,
      merchantId: merchant._id.toString(),
    });

    return {
      merchant,
      membership: {
        merchant: merchant._id,
        userId,
        role: 'owner',
        status: 'active',
        legacy: true,
      },
    };
  }

  let membership;

  if (requestedMerchantId) {
    if (!mongoose.Types.ObjectId.isValid(requestedMerchantId)) {
      return {
        error: {
          statusCode: 400,
          body: {
            message: `Invalid ${ACTIVE_STORE_HEADER} header`,
            code: 'INVALID_MERCHANT_ID',
          },
        },
      };
    }

    membership = memberships.find(
      (m) => m.merchant.toString() === requestedMerchantId
    );

    if (!membership) {
      return {
        error: {
          statusCode: 403,
          body: {
            message: 'You are not a member of that store',
            code: 'NOT_A_MEMBER',
          },
        },
      };
    }
  } else if (memberships.length === 1) {
    membership = memberships[0];
  } else {
    // Ambiguous on purpose: guessing a store here would let a request land on
    // the wrong catalogue or the wrong order list.
    const stores = await Merchant.find({
      _id: { $in: memberships.map((m) => m.merchant) },
    })
      .select('storeName status logoUrl')
      .lean();

    return {
      error: {
        statusCode: 409,
        body: {
          message: `You belong to multiple stores. Send an ${ACTIVE_STORE_HEADER} header to choose one.`,
          code: 'STORE_SELECTION_REQUIRED',
          stores: stores.map((s) => ({
            merchantId: s._id.toString(),
            storeName: s.storeName,
            status: s.status,
            logoUrl: s.logoUrl || null,
            role: memberships.find((m) => m.merchant.toString() === s._id.toString())?.role,
          })),
        },
      },
    };
  }

  // Not lean: controllers such as updateMerchantProfile call .save() on this.
  const merchant = await Merchant.findById(membership.merchant);

  if (!merchant) {
    logger.warn('Membership points at a missing store', {
      userId,
      merchantId: membership.merchant?.toString(),
    });
    return {
      error: {
        statusCode: 403,
        body: { message: 'Merchant profile not found', code: 'MERCHANT_NOT_FOUND' },
      },
    };
  }

  return { merchant, membership };
};

/**
 * Attach the resolved store to the request. Shared by the gates below so
 * `req.merchant` means exactly the same thing everywhere.
 */
const attachMerchant = (req, merchant, membership) => {
  req.merchant = merchant;
  req.merchantMembership = membership;
  req.merchantRole = membership.role;
  req.merchantPermissions = permissionsForRole(membership.role);
};

/**
 * Middleware to check if user is a merchant (role check only)
 */
export const isMerchant = async (req, res, next) => {
  try {
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await clerkClient.users.getUser(userId);

    if (user.publicMetadata?.role !== 'merchant') {
      logger.warn('Unauthorized merchant access attempt', {
        requestId: req.requestId,
        userId: userId,
        url: req.url,
        role: user.publicMetadata?.role,
      });
      return res.status(403).json({ message: 'Merchants only' });
    }

    next();
  } catch (error) {
    logger.error('Error in isMerchant middleware', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Middleware to check if the caller may act for an approved store.
 *
 * Checks the Clerk role as a coarse gate, then resolves the specific store the
 * caller is acting for through MerchantMember. Attaches `req.merchant` — same
 * shape as before memberships existed — plus `req.merchantMembership`.
 */
export const isApprovedMerchant = async (req, res, next) => {
  try {
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Check Clerk role
    const user = await clerkClient.users.getUser(userId);

    if (user.publicMetadata?.role !== 'merchant') {
      logger.warn('Unauthorized merchant access attempt (wrong role)', {
        requestId: req.requestId,
        userId: userId,
        url: req.url,
        role: user.publicMetadata?.role,
      });
      return res.status(403).json({ message: 'Merchants only' });
    }

    const { merchant, membership, error } = await resolveMerchantContext(
      userId,
      req.get(ACTIVE_STORE_HEADER)
    );

    if (error) {
      logger.warn('Merchant context resolution failed', {
        requestId: req.requestId,
        userId,
        url: req.url,
        code: error.body.code,
      });
      return res.status(error.statusCode).json(error.body);
    }

    if (merchant.status !== 'approved') {
      logger.warn('Merchant access denied - not approved', {
        requestId: req.requestId,
        userId: userId,
        merchantId: merchant._id.toString(),
        status: merchant.status,
        url: req.url,
      });
      return res.status(403).json({
        message: 'Merchant application not approved',
        status: merchant.status,
      });
    }

    attachMerchant(req, merchant, membership);

    next();
  } catch (error) {
    logger.error('Error in isApprovedMerchant middleware', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Middleware to check if user is either admin or approved merchant
 * Allows admins to bypass merchant checks
 * For merchants, checks if they are approved
 */
export const isAdminOrApprovedMerchant = async (req, res, next) => {
  try {
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Check Clerk role
    const user = await clerkClient.users.getUser(userId);
    const userRole = user.publicMetadata?.role;

    // Allow admins to proceed without merchant checks
    if (userRole === 'admin') {
      logger.info('Admin access granted', {
        requestId: req.requestId,
        userId: userId,
        url: req.url,
      });
      req.merchantIsAdmin = true;
      return next();
    }

    // For merchants, check if they are approved
    if (userRole === 'merchant') {
      const { merchant, membership, error } = await resolveMerchantContext(
        userId,
        req.get(ACTIVE_STORE_HEADER)
      );

      if (error) {
        logger.warn('Merchant context resolution failed', {
          requestId: req.requestId,
          userId,
          url: req.url,
          code: error.body.code,
        });
        // Preserve the pre-membership wording for the "no store at all" case —
        // the dashboard matches on MERCHANT_NOT_FOUND to route to /merchant/apply.
        if (error.body.code === 'MERCHANT_NOT_FOUND') {
          return res.status(403).json({
            message: 'Merchant profile not found. Please complete your merchant application.',
            code: 'MERCHANT_NOT_FOUND',
          });
        }
        return res.status(error.statusCode).json(error.body);
      }

      if (merchant.status !== 'approved') {
        logger.warn('Merchant access denied - not approved', {
          requestId: req.requestId,
          userId: userId,
          merchantId: merchant._id.toString(),
          status: merchant.status,
          url: req.url,
        });
        return res.status(403).json({
          message: `Merchant application status: ${merchant.status}. Only approved merchants can perform this action.`,
          status: merchant.status,
          code: 'MERCHANT_NOT_APPROVED'
        });
      }

      attachMerchant(req, merchant, membership);
      logger.info('Approved merchant access granted', {
        requestId: req.requestId,
        userId: userId,
        merchantId: merchant._id,
        role: membership.role,
        url: req.url,
      });
      return next();
    }

    // User is neither admin nor merchant
    logger.warn('Unauthorized access attempt - not admin or merchant', {
      requestId: req.requestId,
      userId: userId,
      role: userRole,
      url: req.url,
    });
    return res.status(403).json({
      message: 'Only admins and approved merchants can perform this action',
      code: 'FORBIDDEN'
    });
  } catch (error) {
    logger.error('Error in isAdminOrApprovedMerchant middleware', {
      requestId: req.requestId,
      userId: req.auth?.userId || null,
      error: error.message,
      errorName: error.name,
      errorCode: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      url: req.url,
      method: req.method,
    });

    // Check if it's a Clerk API error
    if (error.status || error.statusCode || error.code) {
      return res.status(503).json({
        success: false,
        message: 'Authentication service temporarily unavailable',
        code: 'CLERK_ERROR',
        requestId: req.requestId,
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      code: 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  }
};

/**
 * Load the store named by `:id` so an admin can act on somebody else's team.
 *
 * Sets `req.merchant` to exactly what isApprovedMerchant would have set, which
 * is what lets the team handlers be reused verbatim for both callers instead of
 * growing an admin variant of each. `req.merchantIsAdmin` marks the caller as
 * not a member, so requireMerchantPermission waves them through and the
 * handlers can tell the two apart.
 *
 * Mount AFTER isAdmin — this does no authorization of its own.
 */
export const loadStoreForAdmin = async (req, res, next) => {
  try {
    const merchant = await Merchant.findById(req.params.id);

    if (!merchant) {
      return res.status(404).json({ message: 'Merchant not found', code: 'NOT_FOUND' });
    }

    req.merchant = merchant;
    req.merchantIsAdmin = true;

    // Audited here rather than in each handler: one place cannot be forgotten
    // when a route is added later, and an admin changing who can reach a live
    // store's orders and payouts is precisely the action that has to be
    // reconstructable afterwards. Reads are logged too — "who looked at this
    // team" is part of the same question.
    logger.info('Admin acting on a store team', {
      marker: 'adminStoreTeamAction',
      requestId: req.requestId,
      adminId: req.auth?.userId,
      merchantId: merchant._id.toString(),
      storeName: merchant.storeName,
      method: req.method,
      path: req.originalUrl,
    });

    next();
  } catch (error) {
    logger.error('Error loading store for admin', {
      requestId: req.requestId,
      merchantId: req.params?.id,
      error: error.message,
    });
    res.status(500).json({ message: 'Server error', code: 'INTERNAL_ERROR' });
  }
};

/**
 * Gate a route on a specific store permission. Runs after isApprovedMerchant /
 * isAdminOrApprovedMerchant, which is what puts the membership on the request.
 *
 * Admins that came through isAdminOrApprovedMerchant bypass this — they are not
 * members of the store and have their own authorization.
 *
 * @param {string} permission - a value from lib/merchantPermissions.js
 */
export const requireMerchantPermission = (permission) => (req, res, next) => {
  if (req.merchantIsAdmin) return next();

  const role = req.merchantRole;

  if (!role) {
    logger.error('requireMerchantPermission ran without a resolved merchant', {
      requestId: req.requestId,
      url: req.url,
      permission,
    });
    return res.status(500).json({
      message: 'Server error',
      code: 'INTERNAL_ERROR',
    });
  }

  if (!hasPermission(role, permission)) {
    logger.warn('Merchant permission denied', {
      requestId: req.requestId,
      userId: req.auth?.userId,
      merchantId: req.merchant?._id?.toString(),
      role,
      permission,
      url: req.url,
    });
    return res.status(403).json({
      message: `Your role (${role}) cannot perform this action`,
      code: 'INSUFFICIENT_STORE_PERMISSION',
      required: permission,
      role,
    });
  }

  return next();
};

export { resolveMerchantContext, ACTIVE_STORE_HEADER };
