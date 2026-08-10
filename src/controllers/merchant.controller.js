import mongoose from "mongoose";
import Merchant, { buildUnclaimedUserId, isUnclaimedUserId } from "../models/merchant.model.js";
import Product from "../models/product.model.js";
import Review from "../models/reviews.model.js";
import Notify from "../models/merchantNotify.model.js";
import Currency from "../models/currency.model.js";
import { clerkClient } from '@clerk/express';
import logger from '../lib/logger.js';
import { getAuth } from "@clerk/express";
import { sendSuccess, sendError, sendCreated, sendNotFound, sendUnauthorized, sendForbidden, sendPaginated } from '../lib/response.js';
import { queueMerchantSuspensionEmail, queueMerchantUnsuspensionEmail } from '../services/mailService.js';
import {
  ensureOwnerMembership,
  syncStoreMembersClerkMetadata,
  removeMembershipsForStore,
  syncMemberClerkMetadata,
  checkMembershipReadiness,
} from '../services/merchantMembership.service.js';
import { enrichProductsWithPricing } from './products.controller.js';
import { convertProductPrices } from '../services/currency.service.js';
import { getLatestRate } from '../services/fx.service.js';

// Statuses that allow a user to (re)submit an application by overwriting in place.
// `needs_revision` and `rejected` are explicitly user-actionable: the dashboard
// pending page already routes both back to /merchant/apply, so the controller
// must accept the resubmission rather than 409.
const RESUBMITTABLE_STATUSES = new Set(['needs_revision', 'rejected']);

// Per-status messaging for the apply endpoint. Keeps Arabic/English in lock-step
// and gives the dashboard a stable error code to switch on.
const APPLY_CONFLICTS = {
  pending: {
    code: 'APPLICATION_PENDING',
    message: 'You already have a merchant application under review.',
    messageAr: 'لديك طلب قيد المراجعة بالفعل.',
  },
  approved: {
    code: 'MERCHANT_APPROVED',
    message: 'Your merchant account is already approved.',
    messageAr: 'حسابك التجاري معتمد بالفعل.',
  },
  suspended: {
    code: 'MERCHANT_SUSPENDED',
    message: 'Your merchant account is suspended. Please contact support.',
    messageAr: 'تم تعليق حسابك التجاري. يرجى التواصل مع الدعم.',
  },
};

/**
 * Apply to become a merchant
 * Any authenticated user can apply. Resubmits in place when the existing
 * application is in needs_revision or rejected state.
 */
export const applyToBecomeMerchant = async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return sendUnauthorized(res, "Authentication required");
    }

    const existingMerchant = await Merchant.findOne({ userId });

    if (existingMerchant && !RESUBMITTABLE_STATUSES.has(existingMerchant.status)) {
      const conflict = APPLY_CONFLICTS[existingMerchant.status] || {
        code: 'APPLICATION_CONFLICT',
        message: `Application is in state "${existingMerchant.status}" and cannot be resubmitted.`,
        messageAr: 'لا يمكن إعادة تقديم الطلب في حالته الحالية.',
      };

      logger.info('Merchant application blocked by existing record', {
        requestId: req.requestId,
        userId,
        existingStatus: existingMerchant.status,
        code: conflict.code,
      });

      return sendError(res, {
        message: conflict.message,
        code: conflict.code,
        statusCode: 409,
        details: {
          status: existingMerchant.status,
          messageAr: conflict.messageAr,
        },
      });
    }

    // `banner` is the storefront cover image. Optional like `logoUrl` — the app
    // falls back to generated artwork — but it has to be read here or an
    // applicant who uploads one silently loses it: the validator allows the
    // field, and only the fields destructured below reach the document.
    const {
      storeName, ownerName, phone, email, merchantType,
      nationalId, crNumber, iban, logoUrl, banner, description,
      categories, city, productSamples,
    } = req.body;

    if (!storeName || !email || !ownerName || !phone || !nationalId || !iban || !description || !city || !merchantType) {
      return sendError(res, {
        message: "Required fields: storeName, ownerName, phone, email, merchantType, nationalId, iban, description, city",
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        details: {
          messageAr: 'يرجى تعبئة جميع الحقول المطلوبة.',
        },
      });
    }

    let merchant;
    if (existingMerchant) {
      Object.assign(existingMerchant, {
        storeName, ownerName, phone, email, merchantType,
        nationalId, crNumber, iban, logoUrl, banner, description,
        categories: categories || [],
        city,
        productSamples: productSamples || [],
        status: 'pending',
        rejectionReason: undefined,
        revisionNotes: undefined,
      });
      merchant = await existingMerchant.save();
      await ensureOwnerMembership(merchant, { requestId: req.requestId });

      logger.info('Merchant application resubmitted', {
        requestId: req.requestId,
        userId,
        merchantId: merchant._id.toString(),
        previousStatus: existingMerchant.status,
        storeName,
      });

      return sendSuccess(res, {
        data: merchant,
        message: "Merchant application resubmitted successfully",
      });
    }

    // An admin may have already built this person's store (and its products)
    // before they signed up. Creating a second record here would strand those
    // products on a store the applicant can never reach. Flag the match for an
    // admin to confirm instead — claiming is never automatic, because the store
    // may already hold a balance.
    const unclaimedStore = await Merchant.findOne({
      claimStatus: 'unclaimed',
      email: email.toLowerCase().trim(),
    });

    if (unclaimedStore) {
      unclaimedStore.claimRequestedBy = userId;
      unclaimedStore.claimRequestedAt = new Date();
      await unclaimedStore.save();

      logger.info('Merchant application matched an unclaimed store', {
        requestId: req.requestId,
        userId,
        merchantId: unclaimedStore._id.toString(),
        email: unclaimedStore.email,
      });

      return sendError(res, {
        message: 'A store already exists for this email address. An administrator will review and link it to your account.',
        code: 'STORE_AWAITING_CLAIM',
        statusCode: 409,
        details: {
          storeName: unclaimedStore.storeName,
          messageAr: 'يوجد متجر مسجل بهذا البريد الإلكتروني. سيقوم المسؤول بمراجعته وربطه بحسابك.',
        },
      });
    }

    try {
      merchant = await Merchant.create({
        userId,
        storeName, ownerName, phone, email, merchantType,
        nationalId, crNumber, iban, logoUrl, banner, description,
        categories: categories || [],
        city,
        productSamples: productSamples || [],
        status: 'pending',
      });
    } catch (createErr) {
      // Any duplicate-key error at this point means another row already exists
      // — either a race against another request from the same user, or a stale
      // legacy unique index (e.g. an old `email_1` from a previous schema). In
      // every case we want to return a clean conflict envelope, not let it
      // bubble up as the generic DUPLICATE_ENTRY from the global error handler.
      if (createErr?.code === 11000) {
        const duplicateField =
          Object.keys(createErr.keyPattern || {})[0] ||
          Object.keys(createErr.keyValue || {})[0] ||
          'unknown';
        const concurrent = await Merchant.findOne({ userId });

        logger.warn('Merchant application duplicate-key recovery', {
          requestId: req.requestId,
          userId,
          duplicateField,
          existingStatus: concurrent?.status,
          mineFound: Boolean(concurrent),
        });

        // If we found the caller's own row, this is a real conflict — return
        // the appropriate status-based message.
        if (concurrent) {
          const conflict =
            APPLY_CONFLICTS[concurrent.status] || APPLY_CONFLICTS.pending;
          return sendError(res, {
            message: conflict.message,
            code: conflict.code,
            statusCode: 409,
            details: {
              status: concurrent.status,
              duplicateField,
              messageAr: conflict.messageAr,
            },
          });
        }

        // No row matches this userId, but Mongo still rejected the insert.
        // That means a UNIQUE INDEX exists on a field the schema doesn't
        // populate — usually a leftover from a renamed field (e.g. clerkId →
        // userId). Surface that truthfully so the operator can drop the
        // stale index. DO NOT pretend the user has a pending application.
        logger.error('Merchant insert blocked by stale unique index', {
          requestId: req.requestId,
          userId,
          duplicateField,
          hint: `Drop the stale unique index "${duplicateField}_1" on merchantapplications: db.merchantapplications.dropIndex("${duplicateField}_1")`,
        });
        return sendError(res, {
          message: `Database has a stale unique index on field "${duplicateField}" that the current schema does not populate. Drop the index and retry.`,
          code: 'STALE_UNIQUE_INDEX',
          statusCode: 500,
          details: {
            duplicateField,
            messageAr: 'هناك خلل في إعدادات قاعدة البيانات. يرجى التواصل مع الدعم الفني.',
          },
        });
      }
      throw createErr;
    }

    // The applicant is the store's first member. Without this every new store
    // would depend on the middleware's legacy owner fallback forever, and that
    // fallback is meant to go away.
    await ensureOwnerMembership(merchant, { requestId: req.requestId });

    logger.info('Merchant application submitted', {
      requestId: req.requestId,
      userId,
      merchantId: merchant._id.toString(),
      storeName,
    });

    return sendCreated(res, merchant, "Merchant application submitted successfully");
  } catch (error) {
    logger.error('Error applying to become merchant', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    // Let error handler middleware handle the response
    throw error;
  }
};

/**
 * Withdraw the current user's own merchant application.
 *
 * Lets a user self-clean their pending/rejected/needs_revision row so they can
 * re-apply without admin intervention. Approved or suspended accounts cannot
 * be self-deleted (those have side effects — products listed, orders placed,
 * balances) and must go through the admin flow.
 *
 * Cascades the same way `deleteMerchant` does for consistency.
 */
export const withdrawMyApplication = async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return sendUnauthorized(res, "Authentication required");
    }

    const merchant = await Merchant.findOne({ userId });

    if (!merchant) {
      // Idempotent: nothing to withdraw is fine.
      logger.info('Withdraw application: no record found (no-op)', {
        requestId: req.requestId,
        userId,
      });
      return sendSuccess(res, {
        data: { withdrawn: false },
        message: 'No merchant application to withdraw',
      });
    }

    // Hard guardrails: don't let a user self-delete an approved or suspended
    // account. Those carry products, orders, balances — admin only.
    const SELF_DELETABLE = new Set(['pending', 'rejected', 'needs_revision']);
    if (!SELF_DELETABLE.has(merchant.status)) {
      logger.warn('Withdraw application blocked by status', {
        requestId: req.requestId,
        userId,
        merchantId: merchant._id.toString(),
        status: merchant.status,
      });
      return sendError(res, {
        message: `Cannot withdraw an application in state "${merchant.status}". Contact support.`,
        code: 'WITHDRAW_FORBIDDEN',
        statusCode: 409,
        details: {
          status: merchant.status,
          messageAr: 'لا يمكن سحب الطلب في حالته الحالية. يرجى التواصل مع الدعم.',
        },
      });
    }

    // Best-effort cascade. There shouldn't be live products at these statuses
    // (you can't list products until approved), but defend in depth.
    try {
      await Product.updateMany(
        { merchant: merchant._id, deletedAt: null },
        { $set: { isActive: false } },
      );
    } catch (cascadeErr) {
      logger.error('Withdraw application: product cascade failed (continuing)', {
        requestId: req.requestId,
        userId,
        merchantId: merchant._id.toString(),
        error: cascadeErr.message,
      });
    }

    // Drop the team with the store. A membership left pointing at a deleted
    // store resolves to a 403 for everyone holding one.
    const formerMembers = await removeMembershipsForStore(merchant._id, {
      requestId: req.requestId,
    });

    await Merchant.deleteOne({ _id: merchant._id });

    // Recompute each former member's Clerk standing now the store is gone.
    for (const memberId of formerMembers) {
      await syncMemberClerkMetadata(memberId, { requestId: req.requestId });
    }

    logger.info('Merchant application withdrawn by user', {
      requestId: req.requestId,
      userId,
      merchantId: merchant._id.toString(),
      previousStatus: merchant.status,
    });

    return sendSuccess(res, {
      data: {
        withdrawn: true,
        merchantId: merchant._id,
        previousStatus: merchant.status,
      },
      message: 'Application withdrawn successfully',
    });
  } catch (error) {
    logger.error('Error withdrawing merchant application', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Diagnostic: prove which database the running backend is talking to and
 * whether a merchant row exists for the caller's clerkId. Use this when the
 * apply endpoint claims a row exists but mongosh doesn't see one — it almost
 * always means the backend is connected to a different DB/cluster.
 *
 * No PII other than the caller's own row (and only if they are the owner).
 */
export const merchantDiagnostic = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return sendUnauthorized(res, 'Authentication required');

    const conn = mongoose.connection;
    const collectionName = Merchant.collection?.collectionName ?? 'merchantapplications';

    const totalMerchants = await Merchant.estimatedDocumentCount();
    const myRow = await Merchant.findOne({ userId }).lean();

    const redactedHost = (() => {
      // Don't echo the full URI; just the host so the user can match it to
      // whatever they're connected to in mongosh.
      const host = conn.host || conn.client?.s?.options?.hosts?.[0]?.host || null;
      const port = conn.port || conn.client?.s?.options?.hosts?.[0]?.port || null;
      if (!host) return null;
      return port ? `${host}:${port}` : host;
    })();

    return sendSuccess(res, {
      data: {
        clerkUserId: userId,
        mongo: {
          databaseName: conn.name || conn.db?.databaseName || null,
          host: redactedHost,
          readyState: conn.readyState, // 1 = connected
          collectionName,
        },
        merchantApplications: {
          totalCount: totalMerchants,
          mineExists: Boolean(myRow),
          mine: myRow
            ? {
                _id: myRow._id,
                userId: myRow.userId,
                storeName: myRow.storeName,
                status: myRow.status,
                createdAt: myRow.createdAt,
                updatedAt: myRow.updatedAt,
              }
            : null,
        },
      },
      message: 'Merchant diagnostic snapshot',
    });
  } catch (error) {
    logger.error('Error in merchant diagnostic', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Membership readiness (Admin only).
 *
 * Reports every disagreement between a store's owner pointer (Merchant.userId)
 * and its owner membership row. While the legacy fallback exists in
 * merchant.middleware.js those disagreements are invisible — the resolver drops
 * back to the owner pointer and the store keeps working. Removing the fallback
 * turns each one into a 403 for the store's owner, so this is the check that
 * says whether that removal is safe yet.
 *
 * Same report as `npm run check:memberships`, for when shell access to
 * production is not to hand.
 */
export const getMembershipReadiness = async (req, res) => {
  try {
    const report = await checkMembershipReadiness();

    logger.info('Membership readiness checked', {
      requestId: req.requestId,
      ready: report.ready,
      missing: report.missing.length,
      mismatched: report.mismatched.length,
      orphaned: report.orphaned.length,
    });

    return sendSuccess(res, {
      data: report,
      message: report.ready
        ? 'Every owned store has a matching owner membership'
        : 'Ownership records disagree — see data for details',
    });
  } catch (error) {
    logger.error('Error checking membership readiness', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Get merchant application status for current user
 */
export const getMyMerchantStatus = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return sendUnauthorized(res, "Authentication required");
    }

    const merchant = await Merchant.findOne({ userId });

    if (!merchant) {
      return sendSuccess(res, { data: { hasApplication: false }, message: "No merchant application found" });
    }

    return sendSuccess(res, { data: { merchant, hasApplication: true }, message: "Merchant status retrieved successfully" });
  } catch (error) {
    logger.error('Error getting merchant status', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Get all merchant applications (Admin only)
 */
export const getAllMerchants = async (req, res) => {
  try {
    const { status, claimStatus } = req.query;

    const query = {};
    if (status && ['pending', 'approved', 'rejected', 'needs_revision', 'suspended'].includes(status)) {
      query.status = status;
    }
    if (claimStatus && ['unclaimed', 'claimed'].includes(claimStatus)) {
      query.claimStatus = claimStatus;
    }

    // Sort on createdAt, not appliedAt: the schema has no `appliedAt`, so the
    // old sort was a no-op and the admin list came back in natural order.
    const merchants = await Merchant.find(query).sort({ createdAt: -1 });

    return sendSuccess(res, { data: merchants, message: "Merchants retrieved successfully" });
  } catch (error) {
    logger.error('Error getting all merchants', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Get single merchant by ID (Admin only)
 */
export const getMerchantById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const merchant = await Merchant.findById(id);

    if (!merchant) {
      return sendNotFound(res, "Merchant");
    }

    return sendSuccess(res, { data: merchant, message: "Merchant retrieved successfully" });
  } catch (error) {
    logger.error('Error getting merchant by ID', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Get public store information by ID (Authenticated users)
 * Returns only public information for approved merchants
 */
export const getStoreById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const merchant = await Merchant.findById(id).select(
      'storeName description email phone city status averageRating logoUrl banner categories merchantType'
    ).lean();

    if (!merchant) {
      return sendNotFound(res, "Store");
    }

    // Only return approved merchants as stores
    if (merchant.status !== 'approved') {
      return sendNotFound(res, "Store");
    }

    // Compute total reviews across all merchant products
    const productIds = await Product.find({ merchant: id, isActive: true, deletedAt: null }).distinct('_id');
    const totalReviews = await Review.countDocuments({ product: { $in: productIds }, isVisible: true });

    const storeData = {
      _id: merchant._id,
      storeName: merchant.storeName,
      description: merchant.description,
      email: merchant.email,
      phone: merchant.phone,
      city: merchant.city,
      status: merchant.status,
      rating: merchant.averageRating || 4.5,
      verified: merchant.status === 'approved',
      logoUrl: merchant.logoUrl || null,
      banner: merchant.banner || null,
      categories: merchant.categories || [],
      merchantType: merchant.merchantType,
      totalReviews,
    };

    return sendSuccess(res, { data: storeData, message: "Store retrieved successfully" });
  } catch (error) {
    logger.error('Error getting store by ID', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Get products for a public store page (public endpoint)
 * Returns only active products for approved merchants
 */
export const getStoreProducts = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 50, 100));
    const skip = (page - 1) * limit;

    // Verify merchant exists and is approved
    const merchant = await Merchant.findById(id).select('status').lean();
    
    if (!merchant) {
      return sendNotFound(res, "Store not found");
    }

    if (merchant.status !== 'approved') {
      return sendNotFound(res, "Store not found");
    }

    // Get active products for this merchant
    const filter = {
      merchant: id,
      isActive: true,
      deletedAt: null,
    };

    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .populate('merchant', 'storeName logoUrl status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalProducts = await Product.countDocuments(filter);

    // Same two-stage treatment every other product surface gets (see
    // products.controller.js:getAllProducts). Without it the storefront serves
    // raw merchant base prices — no markup, no discount, no FX — and the client
    // renders those numbers under the shopper's own currency symbol.
    const enrichedProducts = enrichProductsWithPricing(products);

    const currencyCode = (req.currencyCode || 'USD').toUpperCase();
    let finalProducts = enrichedProducts;

    if (currencyCode !== 'USD') {
      try {
        // Resolve config + rate ONCE for the page rather than per product.
        const [currencyConfig, rateInfo] = await Promise.all([
          Currency.findOne({ code: currencyCode }).lean(),
          getLatestRate(currencyCode),
        ]);

        const currencyContext = { config: currencyConfig, rate: rateInfo };

        finalProducts = await Promise.all(
          enrichedProducts.map((product) =>
            convertProductPrices(product, currencyCode, currencyContext)
          )
        );
      } catch (conversionError) {
        // A missing rate must not empty the storefront — fall back to USD.
        logger.warn('Currency conversion failed for store products, returning USD prices', {
          requestId: req.requestId,
          storeId: id,
          currencyCode,
          error: conversionError.message,
        });
        finalProducts = enrichedProducts;
      }
    }

    logger.info('Store products retrieved', {
      requestId: req.requestId,
      storeId: id,
      total: totalProducts,
      page,
      limit,
      currencyCode,
    });

    return sendPaginated(res, {
      data: finalProducts,
      page,
      limit,
      total: totalProducts,
      message: "Store products retrieved successfully",
    });
  } catch (error) {
    logger.error('Error getting store products', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Approve merchant application (Admin only)
 */
export const approveMerchant = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);
    const { id } = req.params;

    const merchant = await Merchant.findById(id);

    if (!merchant) {
      return sendNotFound(res, "Merchant");
    }

    if (merchant.status === 'approved') {
      return sendError(res, {
        message: "Merchant is already approved",
        code: 'ALREADY_APPROVED',
        statusCode: 400,
      });
    }

    // Update merchant status
    merchant.status = 'approved';
    merchant.approvedAt = new Date();
    merchant.approvedBy = adminId;
    await merchant.save();

    // Update Clerk user's publicMetadata to set role to "merchant" and merchantStatus.
    // Unclaimed stores have a placeholder userId and no Clerk account yet — the
    // metadata write happens at claim time instead (see linkStoreToUser).
    if (isUnclaimedUserId(merchant.userId)) {
      logger.info('Merchant approved; Clerk role deferred until the store is claimed', {
        requestId: req.requestId,
        merchantId: merchant._id,
        approvedBy: adminId,
      });
      return sendSuccess(res, { data: merchant, message: "Merchant approved successfully" });
    }

    // Make sure the owner has a membership before fanning out — an approval can
    // land on a store created before memberships existed.
    await ensureOwnerMembership(merchant, { requestId: req.requestId });

    // Every member gets the new standing, not just the owner. Computed from the
    // database (already saved above), so a member who also works at another
    // store keeps whichever status grants them the most access.
    await syncStoreMembersClerkMetadata(merchant, { requestId: req.requestId });

    logger.info('Merchant approved', {
      requestId: req.requestId,
      merchantId: merchant._id,
      approvedBy: adminId,
    });

    return sendSuccess(res, { data: merchant, message: "Merchant approved successfully" });
  } catch (error) {
    logger.error('Error approving merchant', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Request revisions to a merchant application (Admin only)
 * Sets status to 'needs_revision' so the merchant can edit & resubmit.
 */
export const requestMerchantRevision = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);
    const { id } = req.params;
    const { revisionNotes } = req.body;

    if (!revisionNotes || !revisionNotes.trim()) {
      return sendError(res, {
        message: 'revisionNotes is required',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    }

    const merchant = await Merchant.findById(id);
    if (!merchant) return sendNotFound(res, 'Merchant');

    if (!['pending', 'rejected'].includes(merchant.status)) {
      return sendError(res, {
        message: `Cannot request revision from merchant in status "${merchant.status}"`,
        code: 'INVALID_STATUS',
        statusCode: 400,
      });
    }

    merchant.status = 'needs_revision';
    merchant.revisionNotes = revisionNotes.trim();
    merchant.rejectionReason = undefined;
    await merchant.save();

    logger.info('Merchant revision requested', {
      requestId: req.requestId,
      merchantId: merchant._id,
      userId: merchant.userId,
      adminId,
    });

    // Sync to Clerk metadata so middleware can route the user to the apply page
    await syncStoreMembersClerkMetadata(merchant, { requestId: req.requestId });

    return sendSuccess(res, {
      data: merchant,
      message: 'Revision requested successfully',
    });
  } catch (error) {
    logger.error('Error requesting merchant revision', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Reject merchant application (Admin only)
 */
export const rejectMerchant = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);
    const { id } = req.params;
    const { rejectionReason } = req.body;

    const merchant = await Merchant.findById(id);

    if (!merchant) {
      return sendNotFound(res, "Merchant");
    }

    if (merchant.status === 'rejected') {
      return sendError(res, {
        message: "Merchant is already rejected",
        code: 'ALREADY_REJECTED',
        statusCode: 400,
      });
    }

    // Update merchant status
    merchant.status = 'rejected';
    merchant.rejectionReason = rejectionReason || "Application rejected by admin";
    // Note: approvedBy is NOT set here - it should only be set when approving, not rejecting
    // Rejection and approval are separate audit events and should not mix
    await merchant.save();

    logger.info('Merchant rejected', {
      requestId: req.requestId,
      merchantId: merchant._id,
      userId: merchant.userId,
      rejectedBy: adminId,
      reason: rejectionReason,
    });

    // Update Clerk metadata for every member, not just the owner
    await syncStoreMembersClerkMetadata(merchant, { requestId: req.requestId });

    logger.info('Merchant rejected', {
      requestId: req.requestId,
      merchantId: merchant._id,
      rejectedBy: adminId,
    });

    return sendSuccess(res, { data: merchant, message: "Merchant application rejected" });
  } catch (error) {
    logger.error('Error rejecting merchant', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Get current merchant's profile (Merchant only)
 */
export const getMyMerchantProfile = async (req, res) => {
  try {
    // Resolved by isApprovedMerchant — the store the caller is acting for, which
    // for a staff member is not a store keyed to their own userId.
    const merchant = req.merchant;

    return sendSuccess(res, {
      data: merchant,
      message: "Merchant profile retrieved successfully",
      meta: { role: req.merchantRole, permissions: req.merchantPermissions },
    });
  } catch (error) {
    logger.error('Error getting merchant profile', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Suspend merchant (Admin only)
 */
export const suspendMerchant = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);
    const { id } = req.params;
    const { suspensionReason } = req.body;

    if (!suspensionReason || !suspensionReason.trim()) {
      return sendError(res, {
        message: "Suspension reason is required",
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    }

    const merchant = await Merchant.findById(id);

    if (!merchant) {
      return sendNotFound(res, "Merchant not found");
    }

    if (merchant.status === 'suspended') {
      return sendError(res, {
        message: "Merchant is already suspended",
        code: 'ALREADY_SUSPENDED',
        statusCode: 400,
      });
    }

    if (merchant.status !== 'approved') {
      return sendError(res, {
        message: "Only approved merchants can be suspended",
        code: 'INVALID_STATUS',
        statusCode: 400,
      });
    }

    // Update merchant status
    merchant.status = 'suspended';
    merchant.suspensionReason = suspensionReason.trim();
    merchant.suspendedAt = new Date();
    await merchant.save();

    // Cascade: deactivate this merchant's products so they stop appearing in shop.
    // Soft-update — we don't soft-delete, we just hide. Unsuspend re-enables them.
    try {
      const cascadeResult = await Product.updateMany(
        { merchant: merchant._id, deletedAt: null },
        { $set: { isActive: false } },
      );
      logger.info('Suspended merchant: products deactivated', {
        requestId: req.requestId,
        merchantId: merchant._id,
        modifiedCount: cascadeResult.modifiedCount,
      });
    } catch (cascadeErr) {
      logger.error('Failed to deactivate merchant products on suspension', {
        requestId: req.requestId,
        merchantId: merchant._id,
        error: cascadeErr.message,
      });
      // Don't fail the suspension if cascade fails — the merchant is still suspended
    }

    logger.info('Merchant suspended', {
      requestId: req.requestId,
      merchantId: merchant._id,
      userId: merchant.userId,
      suspendedBy: adminId,
      reason: suspensionReason,
    });

    // Send email notification to merchant
    try {
      await queueMerchantSuspensionEmail({
        to: merchant.email,
        businessName: merchant.storeName,
        suspensionReason: merchant.suspensionReason,
        suspendedAt: merchant.suspendedAt,
      });
      logger.info('Suspension email dispatched to merchant', {
        requestId: req.requestId,
        merchantId: merchant._id,
        email: merchant.email,
      });
    } catch (emailError) {
      logger.error('Failed to send suspension email', {
        requestId: req.requestId,
        merchantId: merchant._id,
        error: emailError.message,
      });
      // Don't fail the request if email fails
    }

    // Create in-app notification for merchant
    try {
      await Notify.create({
        title: 'تم تعليق حسابك التجاري',
        body: `تم تعليق حسابك التجاري "${merchant.storeName}". السبب: ${merchant.suspensionReason}`,
        userId: merchant.userId,
        read: false,
      });
      logger.info('Suspension notification created', {
        requestId: req.requestId,
        merchantId: merchant._id,
        userId: merchant.userId,
      });
    } catch (notifyError) {
      logger.error('Failed to create suspension notification', {
        requestId: req.requestId,
        merchantId: merchant._id,
        error: notifyError.message,
      });
      // Don't fail the request if notification fails
    }

    // Suspension locks out the whole team, not just the owner — otherwise staff
    // would keep working a store the platform has taken offline.
    await syncStoreMembersClerkMetadata(merchant, { requestId: req.requestId });

    logger.info('Merchant suspended', {
      requestId: req.requestId,
      merchantId: merchant._id,
      suspendedBy: adminId,
    });

    return sendSuccess(res, { data: merchant, message: "Merchant suspended successfully" });
  } catch (error) {
    logger.error('Error suspending merchant', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Unsuspend merchant (Admin only)
 */
export const unsuspendMerchant = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);
    const { id } = req.params;

    const merchant = await Merchant.findById(id);

    if (!merchant) {
      return sendNotFound(res, "Merchant not found");
    }

    if (merchant.status !== 'suspended') {
      return sendError(res, {
        message: "Merchant is not suspended",
        code: 'NOT_SUSPENDED',
        statusCode: 400,
      });
    }

    // Restore merchant to approved status
    merchant.status = 'approved';
    merchant.suspensionReason = undefined;
    merchant.suspendedAt = undefined;
    await merchant.save();

    try {
      const cascadeResult = await Product.updateMany(
        { merchant: merchant._id, deletedAt: null },
        { $set: { isActive: true } },
      );
      logger.info('Unsuspended merchant: products reactivated', {
        requestId: req.requestId,
        merchantId: merchant._id,
        modifiedCount: cascadeResult.modifiedCount,
      });
    } catch (cascadeErr) {
      logger.error('Failed to reactivate merchant products on unsuspension', {
        requestId: req.requestId,
        merchantId: merchant._id,
        error: cascadeErr.message,
      });
    }

    logger.info('Merchant unsuspended', {
      requestId: req.requestId,
      merchantId: merchant._id,
      userId: merchant.userId,
      unsuspendedBy: adminId,
    });

    // Send email notification to merchant
    try {
      await queueMerchantUnsuspensionEmail({
        to: merchant.email,
        businessName: merchant.storeName,
      });
      logger.info('Unsuspension email dispatched to merchant', {
        requestId: req.requestId,
        merchantId: merchant._id,
        email: merchant.email,
      });
    } catch (emailError) {
      logger.error('Failed to send unsuspension email', {
        requestId: req.requestId,
        merchantId: merchant._id,
        error: emailError.message,
      });
      // Don't fail the request if email fails
    }

    // Create in-app notification for merchant
    try {
      await Notify.create({
        title: 'تم إلغاء تعليق حسابك التجاري',
        body: `تم إلغاء تعليق حسابك التجاري "${merchant.storeName}". يمكنك الآن متابعة نشاطك التجاري بشكل طبيعي.`,
        userId: merchant.userId,
        read: false,
      });
      logger.info('Unsuspension notification created', {
        requestId: req.requestId,
        merchantId: merchant._id,
        userId: merchant.userId,
      });
    } catch (notifyError) {
      logger.error('Failed to create unsuspension notification', {
        requestId: req.requestId,
        merchantId: merchant._id,
        error: notifyError.message,
      });
      // Don't fail the request if notification fails
    }

    // Restore access for the whole team
    await syncStoreMembersClerkMetadata(merchant, { requestId: req.requestId });

    logger.info('Merchant unsuspended', {
      requestId: req.requestId,
      merchantId: merchant._id,
      unsuspendedBy: adminId,
    });

    return sendSuccess(res, { data: merchant, message: "Merchant unsuspended successfully" });
  } catch (error) {
    logger.error('Error unsuspending merchant', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Delete merchant (Admin only)
 * Cascades: deactivates all merchant products so they stop appearing in shop.
 * Orders keep their merchant snapshot for audit/refund flows.
 */
export const deleteMerchant = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);
    const { id } = req.params;

    const merchant = await Merchant.findById(id);

    if (!merchant) {
      return sendNotFound(res, "Merchant not found");
    }

    // Log before deletion for audit trail
    logger.info('Merchant deletion initiated', {
      requestId: req.requestId,
      merchantId: merchant._id,
      userId: merchant.userId,
      storeName: merchant.storeName,
      status: merchant.status,
      deletedBy: adminId,
    });

    // Cascade: deactivate products first so the storefront stops showing them
    // even if the merchant delete fails afterward.
    try {
      const productCascade = await Product.updateMany(
        { merchant: merchant._id, deletedAt: null },
        { $set: { isActive: false } },
      );
      logger.info('Merchant deletion: products deactivated', {
        requestId: req.requestId,
        merchantId: merchant._id,
        modifiedCount: productCascade.modifiedCount,
      });
    } catch (cascadeErr) {
      logger.error('Failed to deactivate products during merchant deletion', {
        requestId: req.requestId,
        merchantId: merchant._id,
        error: cascadeErr.message,
      });
      // Don't block the delete — admin asked for it explicitly.
    }

    // Drop the team with the store. A membership left pointing at a deleted
    // store resolves to a 403 for everyone holding one.
    const formerMembers = await removeMembershipsForStore(merchant._id, {
      requestId: req.requestId,
    });

    await Merchant.deleteOne({ _id: merchant._id });

    // Recompute each former member's Clerk standing now the store is gone.
    for (const memberId of formerMembers) {
      await syncMemberClerkMetadata(memberId, { requestId: req.requestId });
    }

    logger.info('Merchant deleted', {
      requestId: req.requestId,
      merchantId: id,
      userId: merchant.userId,
      deletedBy: adminId,
    });

    return sendSuccess(res, { data: { id }, message: "Merchant deleted successfully" });
  } catch (error) {
    logger.error('Error deleting merchant', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Purge merchant trail by Clerk userId (Admin only).
 *
 * Recovery tool for the "I deleted the user but they still see لديك طلب موجود"
 * scenario: when a Clerk user has been removed manually (not via the webhook)
 * or when the user.deleted webhook failed, an orphan Merchant row can remain
 * with a userId whose unique index blocks future applications. This endpoint
 * removes that orphan and deactivates any products referencing it.
 *
 * Idempotent: returns 200 with `purged: false` if nothing existed to clean.
 */
export const purgeMerchantByClerkId = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);
    const { clerkId } = req.params;

    if (!clerkId || typeof clerkId !== 'string') {
      return sendError(res, {
        message: 'clerkId path parameter is required',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    }

    const merchant = await Merchant.findOne({ userId: clerkId });

    if (!merchant) {
      logger.info('Merchant purge: no record found for clerkId (no-op)', {
        requestId: req.requestId,
        clerkId,
        adminId,
      });
      return sendSuccess(res, {
        data: { purged: false, clerkId },
        message: 'No merchant record found for this user',
      });
    }

    let productsDeactivated = 0;
    try {
      const cascade = await Product.updateMany(
        { merchant: merchant._id, deletedAt: null },
        { $set: { isActive: false } },
      );
      productsDeactivated = cascade.modifiedCount || 0;
    } catch (cascadeErr) {
      logger.error('Merchant purge: product cascade failed (continuing)', {
        requestId: req.requestId,
        clerkId,
        merchantId: merchant._id,
        error: cascadeErr.message,
      });
    }

    // Drop the team with the store. A membership left pointing at a deleted
    // store resolves to a 403 for everyone holding one.
    const formerMembers = await removeMembershipsForStore(merchant._id, {
      requestId: req.requestId,
    });

    await Merchant.deleteOne({ _id: merchant._id });

    // Recompute each former member's Clerk standing now the store is gone.
    for (const memberId of formerMembers) {
      await syncMemberClerkMetadata(memberId, { requestId: req.requestId });
    }

    logger.info('Merchant purged by clerkId', {
      requestId: req.requestId,
      clerkId,
      merchantId: merchant._id.toString(),
      previousStatus: merchant.status,
      productsDeactivated,
      purgedBy: adminId,
    });

    return sendSuccess(res, {
      data: {
        purged: true,
        clerkId,
        merchantId: merchant._id,
        previousStatus: merchant.status,
        productsDeactivated,
      },
      message: 'Merchant trail purged successfully',
    });
  } catch (error) {
    logger.error('Error purging merchant by clerkId', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Update merchant profile (Merchant only)
 */
export const updateMerchantProfile = async (req, res) => {
  try {
    const { userId } = getAuth(req);

    // Resolved by isApprovedMerchant. The route is additionally gated on
    // profile:write, so only an owner reaches this.
    const merchant = req.merchant;

    const {
      storeName, description, email, phone, city, logoUrl, banner,
      preferredInputCurrency,
    } = req.body;

    if (storeName)              merchant.storeName   = storeName;
    if (description !== undefined) merchant.description = description;
    if (email)                  merchant.email       = email;
    if (phone !== undefined)    merchant.phone       = phone;
    if (city !== undefined)     merchant.city        = city;
    if (logoUrl !== undefined)  merchant.logoUrl     = logoUrl;
    if (banner !== undefined)   merchant.banner      = banner;

    // A form DEFAULT, not a pricing decision — saving it converts nothing and
    // re-prices nothing. Eligibility is enforced where money is actually
    // converted (products.controller → getInputCurrencyContext), so this
    // accepts any well-formed code and lets a stale preference fail loudly at
    // the point of sale rather than silently blocking a profile save.
    if (preferredInputCurrency !== undefined) {
      merchant.preferredInputCurrency =
        String(preferredInputCurrency || 'USD').trim().toUpperCase() || 'USD';
    }

    await merchant.save();

    logger.info('Merchant profile updated', {
      requestId: req.requestId,
      clerkId: userId,
    });

    return sendSuccess(res, { data: merchant, message: "Merchant profile updated successfully" });
  } catch (error) {
    logger.error('Error updating merchant profile', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Freeze merchant (Admin only) — manual flag toggle for risk/abuse.
 */
export const freezeMerchant = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);
    const { id } = req.params;
    const { reason } = req.body || {};

    const merchant = await Merchant.findByIdAndUpdate(
      id,
      {
        isFlagged: true,
        flaggedAt: new Date(),
        flagReason: reason || 'Manual admin freeze',
      },
      { new: true }
    );

    if (!merchant) {
      return sendNotFound(res, "Merchant");
    }

    logger.info('Merchant frozen by admin', {
      requestId: req.requestId,
      merchantId: merchant._id,
      adminId,
      reason: merchant.flagReason,
    });

    return sendSuccess(res, { data: merchant, message: "Merchant frozen successfully" });
  } catch (error) {
    logger.error('Error freezing merchant', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Get reviews for all products belonging to a store (public endpoint)
 */
export const getStoreReviews = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 20, 50));
    const skip = (page - 1) * limit;

    const merchant = await Merchant.findById(id).select('status').lean();
    if (!merchant || merchant.status !== 'approved') {
      return sendNotFound(res, "Store");
    }

    const productIds = await Product.find({ merchant: id, isActive: true, deletedAt: null }).distinct('_id');

    const [reviews, total] = await Promise.all([
      Review.find({ product: { $in: productIds }, isVisible: true })
        .populate('user', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments({ product: { $in: productIds }, isVisible: true }),
    ]);

    const formatted = reviews.map((r) => ({
      _id: r._id,
      userName: r.user?.name || 'Anonymous',
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
    }));

    return sendPaginated(res, {
      data: formatted,
      page,
      limit,
      total,
      message: "Store reviews retrieved successfully",
    });
  } catch (error) {
    logger.error('Error getting store reviews', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Get all public merchants (Active & Approved)
 * Public endpoint for listing stores
 */
export const getPublicMerchants = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 20, 50));
    const skip = (page - 1) * limit;

    const filter = { status: 'approved' };

    const merchants = await Merchant.find(filter)
      .select('storeName description email phone city status averageRating logoUrl banner categories userId')
      .sort({ averageRating: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Merchant.countDocuments(filter);

    return sendPaginated(res, {
      data: merchants,
      page,
      limit,
      total,
      message: "Merchants retrieved successfully",
    });
  } catch (error) {
    logger.error('Error getting public merchants', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Create a store on a merchant's behalf (Admin only)
 *
 * Lets an admin onboard a seller who has not registered — or cannot navigate the
 * application flow — so products can be listed immediately. The store gets a
 * placeholder userId and claimStatus 'unclaimed'; products attach to its _id,
 * which survives the later claim untouched.
 */
export const createStoreForMerchant = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);

    const {
      storeName, ownerName, email, phone, merchantType,
      nationalId, crNumber, iban, logoUrl, banner, description,
      categories, city, productSamples,
    } = req.body;

    const normalizedEmail = email.toLowerCase().trim();

    // The email is the claim key — a duplicate would make it ambiguous which
    // store an applicant is entitled to.
    const existing = await Merchant.findOne({ email: normalizedEmail });
    if (existing) {
      return sendError(res, {
        message: `A ${existing.claimStatus === 'unclaimed' ? 'store' : 'merchant account'} already exists for ${normalizedEmail}`,
        code: 'MERCHANT_EMAIL_TAKEN',
        statusCode: 409,
        details: {
          merchantId: existing._id.toString(),
          storeName: existing.storeName,
          claimStatus: existing.claimStatus,
        },
      });
    }

    const merchant = await Merchant.create({
      userId: buildUnclaimedUserId(),
      storeName,
      ownerName,
      email: normalizedEmail,
      phone,
      merchantType: merchantType || 'individual',
      nationalId,
      crNumber,
      iban,
      logoUrl,
      banner,
      description,
      categories: categories || [],
      city,
      productSamples: productSamples || [],
      // Approved on creation — an admin vouching for the store IS the review,
      // and products cannot sell under any other status.
      status: 'approved',
      approvedAt: new Date(),
      approvedBy: adminId,
      claimStatus: 'unclaimed',
      createdByAdmin: adminId,
    });

    logger.info('Unclaimed store created by admin', {
      requestId: req.requestId,
      merchantId: merchant._id.toString(),
      storeName,
      email: normalizedEmail,
      adminId,
    });

    return sendCreated(res, merchant, 'Store created successfully');
  } catch (error) {
    logger.error('Error creating store for merchant', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Edit a store (Admin only)
 *
 * Works on claimed stores as well as unclaimed ones — admins need to fix a
 * logo, a typo or a wrong city on a live merchant without waiting for the owner.
 *
 * Editing a CLAIMED store is the more sensitive half of this endpoint: the data
 * belongs to a real merchant, and `iban` / `nationalId` / `crNumber` decide
 * where money goes. There is no schema-level guard against that — the store
 * owner cannot see an admin edit — so accountability is provided by the audit
 * log below, which records the admin, the store, and the before/after of every
 * payout or identity field touched on a claimed store. Keep that logging intact
 * if you extend this handler.
 *
 * Ownership itself is NOT editable here: `userId` and `claimStatus` are never
 * read from the body, so no edit can hand a store to a different account.
 * Re-pointing a claim goes through link-user / unlink, which is audited
 * separately.
 */

// Fields that move money or prove identity. Changing one of these on a store
// somebody actually owns is worth a dedicated log line.
const SENSITIVE_MERCHANT_FIELDS = ['iban', 'nationalId', 'crNumber', 'email'];

export const updateStoreForMerchant = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);
    const { id } = req.params;

    const merchant = await Merchant.findById(id);
    if (!merchant) return sendNotFound(res, "Merchant");

    const isClaimed = merchant.claimStatus !== 'unclaimed';

    // Snapshot before mutation so the audit log can report what actually changed.
    const before = SENSITIVE_MERCHANT_FIELDS.reduce((acc, field) => {
      acc[field] = merchant[field];
      return acc;
    }, {});

    const {
      storeName, ownerName, email, phone, merchantType,
      nationalId, crNumber, iban, logoUrl, banner, description,
      categories, city, productSamples,
    } = req.body;

    // Email is the claim key for an unclaimed store, so a change has to stay
    // unique across every store — otherwise two stores would compete for the
    // same signup. On a claimed store it is only contact info (ownership lives
    // in userId), but uniqueness still has to hold for the same reason.
    if (email !== undefined) {
      const normalizedEmail = email.toLowerCase().trim();

      if (normalizedEmail !== merchant.email) {
        const clash = await Merchant.findOne({
          email: normalizedEmail,
          _id: { $ne: merchant._id },
        });

        if (clash) {
          return sendError(res, {
            message: `A ${clash.claimStatus === 'unclaimed' ? 'store' : 'merchant account'} already exists for ${normalizedEmail}`,
            code: 'MERCHANT_EMAIL_TAKEN',
            statusCode: 409,
            details: {
              merchantId: clash._id.toString(),
              storeName: clash.storeName,
              claimStatus: clash.claimStatus,
            },
          });
        }

        // A pending claim was raised by whoever signed up with the OLD address.
        // Keeping it would let an admin retarget the store at a different email
        // while a stale confirm button still points at the previous applicant.
        if (merchant.claimRequestedBy) {
          logger.info('Clearing pending claim request after store email change', {
            requestId: req.requestId,
            merchantId: merchant._id.toString(),
            previousEmail: merchant.email,
            newEmail: normalizedEmail,
          });
          merchant.claimRequestedBy = null;
          merchant.claimRequestedAt = undefined;
        }

        merchant.email = normalizedEmail;
      }
    }

    if (storeName    !== undefined) merchant.storeName    = storeName;
    if (ownerName    !== undefined) merchant.ownerName    = ownerName;
    if (phone        !== undefined) merchant.phone        = phone;
    if (merchantType !== undefined) merchant.merchantType = merchantType;
    if (nationalId   !== undefined) merchant.nationalId   = nationalId;
    if (crNumber     !== undefined) merchant.crNumber     = crNumber;
    if (iban         !== undefined) merchant.iban         = iban;
    if (logoUrl      !== undefined) merchant.logoUrl      = logoUrl;
    if (banner       !== undefined) merchant.banner       = banner;
    if (description  !== undefined) merchant.description  = description;
    if (city         !== undefined) merchant.city         = city;
    if (categories   !== undefined) merchant.categories   = categories;
    if (productSamples !== undefined) merchant.productSamples = productSamples;

    await merchant.save();

    logger.info('Store updated by admin', {
      requestId: req.requestId,
      merchantId: merchant._id.toString(),
      claimStatus: merchant.claimStatus,
      adminId,
    });

    // Audit trail for the case the old "unclaimed only" restriction used to
    // prevent outright: an admin rewriting payout or identity details on a
    // store a real merchant owns. Logged at warn so it surfaces without
    // trawling info logs, and only when a value actually changed.
    if (isClaimed) {
      const changed = SENSITIVE_MERCHANT_FIELDS
        .filter((field) => before[field] !== merchant[field])
        .map((field) => ({ field, from: before[field] ?? null, to: merchant[field] ?? null }));

      if (changed.length > 0) {
        logger.warn('Admin changed sensitive fields on a CLAIMED store', {
          requestId: req.requestId,
          merchantId: merchant._id.toString(),
          ownerUserId: merchant.userId,
          adminId,
          changed,
        });
      }
    }

    return sendSuccess(res, { data: merchant, message: 'Store updated successfully' });
  } catch (error) {
    logger.error('Error updating store', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

/**
 * Find registered Clerk users matching an unclaimed store's email (Admin only)
 *
 * Read-only helper that powers the "link owner" dialog. Returns candidates and
 * whether each already owns a store — it never mutates anything.
 */
export const getStoreClaimCandidates = async (req, res) => {
  try {
    const { id } = req.params;

    const merchant = await Merchant.findById(id);
    if (!merchant) return sendNotFound(res, "Merchant");

    if (merchant.claimStatus !== 'unclaimed') {
      return sendError(res, {
        message: 'This store is already linked to a user',
        code: 'STORE_ALREADY_CLAIMED',
        statusCode: 400,
      });
    }

    const searchEmail = (req.query.email || merchant.email || '').toLowerCase().trim();

    let clerkUsers = [];
    try {
      const result = await clerkClient.users.getUserList({
        emailAddress: [searchEmail],
        limit: 10,
      });
      clerkUsers = result?.data || [];
    } catch (clerkError) {
      logger.error('Clerk lookup failed while resolving claim candidates', {
        requestId: req.requestId,
        merchantId: id,
        error: clerkError.message,
      });
      return sendError(res, {
        message: 'Could not reach the identity provider. Try again shortly.',
        code: 'CLERK_ERROR',
        statusCode: 503,
      });
    }

    // Flag candidates that already own a store — linking those would orphan
    // whichever store loses the userId.
    const clerkIds = clerkUsers.map((u) => u.id);
    const ownedStores = clerkIds.length
      ? await Merchant.find({ userId: { $in: clerkIds } }).select('userId storeName').lean()
      : [];
    const ownedByUserId = new Map(ownedStores.map((s) => [s.userId, s]));

    const candidates = clerkUsers.map((u) => {
      const owned = ownedByUserId.get(u.id);
      return {
        clerkUserId: u.id,
        email: u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress
          || u.emailAddresses?.[0]?.emailAddress
          || null,
        firstName: u.firstName,
        lastName: u.lastName,
        imageUrl: u.imageUrl,
        role: u.publicMetadata?.role || null,
        existingStore: owned ? { storeName: owned.storeName } : null,
        linkable: !owned,
      };
    });

    return sendSuccess(res, {
      data: {
        merchant: {
          _id: merchant._id,
          storeName: merchant.storeName,
          email: merchant.email,
          claimRequestedBy: merchant.claimRequestedBy,
          claimRequestedAt: merchant.claimRequestedAt,
        },
        searchEmail,
        candidates,
      },
      message: 'Claim candidates retrieved successfully',
    });
  } catch (error) {
    logger.error('Error getting store claim candidates', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Link an unclaimed store to a registered user (Admin only)
 *
 * The confirmation step of the claim flow. Rewrites the placeholder userId to the
 * real Clerk id and grants the merchant role. Products reference Merchant._id, so
 * they carry over with no migration.
 */
export const linkStoreToUser = async (req, res) => {
  try {
    const { userId: adminId } = getAuth(req);
    const { id } = req.params;
    const { clerkUserId } = req.body;

    const merchant = await Merchant.findById(id);
    if (!merchant) return sendNotFound(res, "Merchant");

    if (merchant.claimStatus !== 'unclaimed') {
      return sendError(res, {
        message: 'This store is already linked to a user',
        code: 'STORE_ALREADY_CLAIMED',
        statusCode: 400,
        details: { userId: merchant.userId },
      });
    }

    // Resolve the target user before touching anything.
    try {
      // Existence check only — the metadata write goes through the membership
      // sync further down.
      await clerkClient.users.getUser(clerkUserId);
    } catch (clerkError) {
      logger.warn('Clerk user lookup failed during store link', {
        requestId: req.requestId,
        merchantId: id,
        clerkUserId,
        error: clerkError.message,
      });
      return sendError(res, {
        message: 'No registered user found with that id',
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      });
    }

    // One store per user: userId is unique, so this would fail at the index
    // anyway — a clear 409 beats an E11000.
    const alreadyOwns = await Merchant.findOne({ userId: clerkUserId });
    if (alreadyOwns) {
      return sendError(res, {
        message: 'That user already owns a store',
        code: 'USER_ALREADY_MERCHANT',
        statusCode: 409,
        details: {
          merchantId: alreadyOwns._id.toString(),
          storeName: alreadyOwns.storeName,
        },
      });
    }

    const previousUserId = merchant.userId;

    merchant.userId = clerkUserId;
    merchant.claimStatus = 'claimed';
    merchant.claimedAt = new Date();
    merchant.claimedBy = adminId;
    merchant.claimRequestedBy = null;
    merchant.claimRequestedAt = undefined;
    await merchant.save();

    // Repoints (or creates) the owner row at the account taking the store over.
    // Products reference Merchant._id, so nothing else has to move.
    await ensureOwnerMembership(merchant, { requestId: req.requestId });

    // Clerk metadata is what the dashboard middleware gates on — without this the
    // owner is linked in Mongo but still locked out of /merchant/*. Computed
    // from memberships so an owner who also works at another store keeps
    // whichever standing grants them the most access.
    const synced = await syncMemberClerkMetadata(clerkUserId, { requestId: req.requestId });

    if (!synced) {
      // The link itself succeeded; surface the partial failure so an admin can
      // retry rather than silently leaving the owner without dashboard access.
      logger.error('Store linked but Clerk role update failed', {
        requestId: req.requestId,
        merchantId: merchant._id.toString(),
        clerkUserId,
      });
      return sendSuccess(res, {
        data: merchant,
        message: 'Store linked, but granting merchant access failed. Re-run the link to retry.',
      });
    }

    logger.info('Unclaimed store linked to user', {
      requestId: req.requestId,
      merchantId: merchant._id.toString(),
      previousUserId,
      clerkUserId,
      adminId,
    });

    return sendSuccess(res, { data: merchant, message: 'Store linked to user successfully' });
  } catch (error) {
    logger.error('Error linking store to user', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};
