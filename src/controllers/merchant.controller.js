import Merchant from "../models/merchant.model.js";
import Product from "../models/product.model.js";
import Review from "../models/reviews.model.js";
import Notify from "../models/merchantNotify.model.js";
import { clerkClient } from '@clerk/express';
import logger from '../lib/logger.js';
import { getAuth } from "@clerk/express";
import { sendSuccess, sendError, sendCreated, sendNotFound, sendUnauthorized, sendForbidden, sendPaginated } from '../lib/response.js';
import { queueMerchantSuspensionEmail, queueMerchantUnsuspensionEmail } from '../services/mailService.js';

/**
 * Apply to become a merchant
 * Any authenticated user can apply
 */
export const applyToBecomeMerchant = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return sendUnauthorized(res, "Authentication required");
    }

    // Check if user already has a merchant application
    const existingMerchant = await Merchant.findOne({ userId });

    if (existingMerchant) {
      return sendError(res, {
        message: "You already have a merchant application",
        code: 'DUPLICATE_APPLICATION',
        statusCode: 409,
        details: { status: existingMerchant.status },
      });
    }

    const {
      storeName, ownerName, phone, email, merchantType,
      nationalId, crNumber, iban, logoUrl, description,
      categories, city, productSamples,
    } = req.body;

    if (!storeName || !email || !ownerName || !phone || !nationalId || !iban || !description || !city || !merchantType) {
      return sendError(res, {
        message: "Required fields: storeName, ownerName, phone, email, merchantType, nationalId, iban, description, city",
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    }

    const merchant = new Merchant({
      userId,
      storeName, ownerName, phone, email, merchantType,
      nationalId, crNumber, iban, logoUrl, description,
      categories: categories || [],
      city,
      productSamples: productSamples || [],
      status: 'pending',
    });

    await merchant.save();

    logger.info('Merchant application submitted', {
      requestId: req.requestId,
      userId,
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
    const { status } = req.query;
    
    const query = {};
    if (status && ['pending', 'approved', 'rejected', 'needs_revision', 'suspended'].includes(status)) {
      query.status = status;
    }

    const merchants = await Merchant.find(query).sort({ appliedAt: -1 });

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

    logger.info('Store products retrieved', {
      requestId: req.requestId,
      storeId: id,
      total: totalProducts,
      page,
      limit,
    });

    return sendPaginated(res, {
      data: products,
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

    // Update Clerk user's publicMetadata to set role to "merchant" and merchantStatus
    try {
      // Get existing metadata to preserve other fields
      const clerkUser = await clerkClient.users.getUser(merchant.userId);
      const existingMetadata = clerkUser.publicMetadata || {};

      await clerkClient.users.updateUser(merchant.userId, {
        publicMetadata: {
          ...existingMetadata,
          role: "merchant",
          merchantStatus: "approved",
        },
      });

      logger.info('Merchant approved and role updated in Clerk', {
        requestId: req.requestId,
        merchantId: merchant._id,
        userId: merchant.userId,
        approvedBy: adminId,
      });
    } catch (clerkError) {
      logger.error('Error updating Clerk role', {
        requestId: req.requestId,
        error: clerkError.message,
        userId: merchant.userId,
      });
      // Continue even if Clerk update fails - merchant is still approved in DB
    }

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
    try {
      const clerkUser = await clerkClient.users.getUser(merchant.userId);
      const existingMetadata = clerkUser.publicMetadata || {};
      await clerkClient.users.updateUser(merchant.userId, {
        publicMetadata: {
          ...existingMetadata,
          merchantStatus: 'needs_revision',
        },
      });
    } catch (clerkError) {
      logger.error('Failed to sync needs_revision to Clerk', {
        requestId: req.requestId,
        userId: merchant.userId,
        error: clerkError.message,
      });
    }

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

    // Update Clerk user's publicMetadata to set merchantStatus to rejected
    try {
      const clerkUser = await clerkClient.users.getUser(merchant.userId);
      const existingMetadata = clerkUser.publicMetadata || {};

      await clerkClient.users.updateUser(merchant.userId, {
        publicMetadata: {
          ...existingMetadata,
          merchantStatus: "rejected",
        },
      });

      logger.info('Merchant rejected and Clerk metadata updated', {
        requestId: req.requestId,
        merchantId: merchant._id,
        userId: merchant.userId,
        rejectedBy: adminId,
      });
    } catch (clerkError) {
      logger.error('Error updating Clerk metadata on rejection', {
        requestId: req.requestId,
        error: clerkError.message,
        userId: merchant.userId,
      });
      // Continue even if Clerk update fails - merchant is still rejected in DB
    }

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
    const { userId } = getAuth(req);
    
    if (!userId) {
      return sendUnauthorized(res, "Authentication required");
    }

    const merchant = await Merchant.findOne({ userId });

    if (!merchant) {
      return sendNotFound(res, "Merchant profile");
    }

    return sendSuccess(res, { data: merchant, message: "Merchant profile retrieved successfully" });
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

    // Update Clerk user's publicMetadata to set merchantStatus to suspended
    try {
      const clerkUser = await clerkClient.users.getUser(merchant.userId);
      const existingMetadata = clerkUser.publicMetadata || {};

      await clerkClient.users.updateUser(merchant.userId, {
        publicMetadata: {
          ...existingMetadata,
          merchantStatus: "suspended",
        },
      });

      logger.info('Merchant suspended and Clerk metadata updated', {
        requestId: req.requestId,
        merchantId: merchant._id,
        userId: merchant.userId,
        suspendedBy: adminId,
      });
    } catch (clerkError) {
      logger.error('Error updating Clerk metadata on suspension', {
        requestId: req.requestId,
        error: clerkError.message,
        userId: merchant.userId,
      });
      // Continue even if Clerk update fails - merchant is still suspended in DB
    }

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

    // Update Clerk user's publicMetadata to restore merchantStatus to approved
    try {
      const clerkUser = await clerkClient.users.getUser(merchant.userId);
      const existingMetadata = clerkUser.publicMetadata || {};

      await clerkClient.users.updateUser(merchant.userId, {
        publicMetadata: {
          ...existingMetadata,
          role: "merchant",
          merchantStatus: "approved",
        },
      });

      logger.info('Merchant unsuspended and Clerk metadata updated', {
        requestId: req.requestId,
        merchantId: merchant._id,
        userId: merchant.userId,
        unsuspendedBy: adminId,
      });
    } catch (clerkError) {
      logger.error('Error updating Clerk metadata on unsuspension', {
        requestId: req.requestId,
        error: clerkError.message,
        userId: merchant.userId,
      });
      // Continue even if Clerk update fails - merchant is still unsuspended in DB
    }

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

    // Delete the merchant
    await Merchant.findByIdAndDelete(id);

    logger.info('Merchant deleted', {
      requestId: req.requestId,
      merchantId: id,
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
 * Update merchant profile (Merchant only)
 */
export const updateMerchantProfile = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const merchant = await Merchant.findOne({ userId });

    if (!merchant) {
      return res.status(404).json({ message: "Merchant profile not found" });
    }

    const { storeName, description, email, phone, city, logoUrl, banner } = req.body;

    if (storeName)              merchant.storeName   = storeName;
    if (description !== undefined) merchant.description = description;
    if (email)                  merchant.email       = email;
    if (phone !== undefined)    merchant.phone       = phone;
    if (city !== undefined)     merchant.city        = city;
    if (logoUrl !== undefined)  merchant.logoUrl     = logoUrl;
    if (banner !== undefined)   merchant.banner      = banner;

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
