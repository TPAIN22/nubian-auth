import Merchant from "../models/merchant.model.js";
import Product from "../models/product.model.js";
import Notify from "../models/notify.model.js";
import { clerkClient } from '@clerk/express';
import logger from '../lib/logger.js';
import { getAuth } from "@clerk/express";
import { sendSuccess, sendError, sendCreated, sendNotFound, sendUnauthorized, sendForbidden, sendPaginated } from '../lib/response.js';
import { sendMerchantSuspensionEmail, sendMerchantUnsuspensionEmail } from '../lib/mail.js';

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
    const existingMerchant = await Merchant.findOne({ clerkId: userId });
    
    if (existingMerchant) {
      return sendError(res, {
        message: "You already have a merchant application",
        code: 'DUPLICATE_APPLICATION',
        statusCode: 409,
        details: { status: existingMerchant.status },
      });
    }

    const { businessName, businessDescription, businessEmail, businessPhone, businessAddress } = req.body;

    if (!businessName || !businessEmail) {
      return sendError(res, {
        message: "Business name and email are required",
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    }

    const merchant = new Merchant({
      clerkId: userId,
      businessName,
      businessDescription,
      businessEmail,
      businessPhone,
      businessAddress,
      status: "PENDING",
      appliedAt: new Date(),
    });

    await merchant.save();

    logger.info('Merchant application submitted', {
      requestId: req.requestId,
      clerkId: userId,
      businessName,
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

    const merchant = await Merchant.findOne({ clerkId: userId });

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
    if (status && ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'].includes(status)) {
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
      'businessName businessDescription businessEmail businessPhone businessAddress status averageRating'
    ).lean();

    if (!merchant) {
      return sendNotFound(res, "Store");
    }

    // Only return approved merchants as stores
    if (merchant.status !== 'APPROVED') {
      return sendNotFound(res, "Store");
    }

    // Format response to match store interface
    const storeData = {
      _id: merchant._id,
      businessName: merchant.businessName,
      businessDescription: merchant.businessDescription,
      businessEmail: merchant.businessEmail,
      businessPhone: merchant.businessPhone,
      businessAddress: merchant.businessAddress,
      status: merchant.status,
      rating: merchant.averageRating || 4.5,
      verified: merchant.status === 'APPROVED',
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

    if (merchant.status !== 'APPROVED') {
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
      .populate('merchant', 'businessName status')
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

    if (merchant.status === "APPROVED") {
      return sendError(res, {
        message: "Merchant is already approved",
        code: 'ALREADY_APPROVED',
        statusCode: 400,
      });
    }

    // Update merchant status
    merchant.status = "APPROVED";
    merchant.approvedAt = new Date();
    merchant.approvedBy = adminId;
    await merchant.save();

    // Update Clerk user's publicMetadata to set role to "merchant" and merchantStatus
    try {
      // Get existing metadata to preserve other fields
      const clerkUser = await clerkClient.users.getUser(merchant.clerkId);
      const existingMetadata = clerkUser.publicMetadata || {};
      
      await clerkClient.users.updateUser(merchant.clerkId, {
        publicMetadata: {
          ...existingMetadata,
          role: "merchant",
          merchantStatus: "APPROVED",
        },
      });

      logger.info('Merchant approved and role updated in Clerk', {
        requestId: req.requestId,
        merchantId: merchant._id,
        clerkId: merchant.clerkId,
        approvedBy: adminId,
      });
    } catch (clerkError) {
      logger.error('Error updating Clerk role', {
        requestId: req.requestId,
        error: clerkError.message,
        clerkId: merchant.clerkId,
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

    if (merchant.status === "REJECTED") {
      return sendError(res, {
        message: "Merchant is already rejected",
        code: 'ALREADY_REJECTED',
        statusCode: 400,
      });
    }

    // Update merchant status
    merchant.status = "REJECTED";
    merchant.rejectionReason = rejectionReason || "Application rejected by admin";
    // Note: approvedBy is NOT set here - it should only be set when approving, not rejecting
    // Rejection and approval are separate audit events and should not mix
    await merchant.save();

    logger.info('Merchant rejected', {
      requestId: req.requestId,
      merchantId: merchant._id,
      clerkId: merchant.clerkId,
      rejectedBy: adminId,
      reason: rejectionReason,
    });

    // Update Clerk user's publicMetadata to set merchantStatus to REJECTED
    // Note: We don't remove the role field here as Clerk merges metadata.
    // The middleware should check merchantStatus along with role for access control.
    try {
      const clerkUser = await clerkClient.users.getUser(merchant.clerkId);
      const existingMetadata = clerkUser.publicMetadata || {};
      
      await clerkClient.users.updateUser(merchant.clerkId, {
        publicMetadata: {
          ...existingMetadata,
          merchantStatus: "REJECTED",
          // Keep role as-is since Clerk merges metadata (can't easily remove fields)
          // Middleware should check merchantStatus for access control
        },
      });

      logger.info('Merchant rejected and Clerk metadata updated', {
        requestId: req.requestId,
        merchantId: merchant._id,
        clerkId: merchant.clerkId,
        rejectedBy: adminId,
      });
    } catch (clerkError) {
      logger.error('Error updating Clerk metadata on rejection', {
        requestId: req.requestId,
        error: clerkError.message,
        clerkId: merchant.clerkId,
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

    const merchant = await Merchant.findOne({ clerkId: userId });

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

    if (merchant.status === "SUSPENDED") {
      return sendError(res, {
        message: "Merchant is already suspended",
        code: 'ALREADY_SUSPENDED',
        statusCode: 400,
      });
    }

    if (merchant.status !== "APPROVED") {
      return sendError(res, {
        message: "Only approved merchants can be suspended",
        code: 'INVALID_STATUS',
        statusCode: 400,
      });
    }

    // Update merchant status
    merchant.status = "SUSPENDED";
    merchant.suspensionReason = suspensionReason.trim();
    merchant.suspendedAt = new Date();
    await merchant.save();

    logger.info('Merchant suspended', {
      requestId: req.requestId,
      merchantId: merchant._id,
      clerkId: merchant.clerkId,
      suspendedBy: adminId,
      reason: suspensionReason,
    });

    // Send email notification to merchant
    try {
      await sendMerchantSuspensionEmail({
        to: merchant.businessEmail,
        businessName: merchant.businessName,
        suspensionReason: merchant.suspensionReason,
        suspendedAt: merchant.suspendedAt,
      });
      logger.info('Suspension email sent to merchant', {
        requestId: req.requestId,
        merchantId: merchant._id,
        email: merchant.businessEmail,
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
        body: `تم تعليق حسابك التجاري "${merchant.businessName}". السبب: ${merchant.suspensionReason}`,
        userId: merchant.clerkId,
        read: false,
      });
      logger.info('Suspension notification created', {
        requestId: req.requestId,
        merchantId: merchant._id,
        clerkId: merchant.clerkId,
      });
    } catch (notifyError) {
      logger.error('Failed to create suspension notification', {
        requestId: req.requestId,
        merchantId: merchant._id,
        error: notifyError.message,
      });
      // Don't fail the request if notification fails
    }

    // Update Clerk user's publicMetadata to set merchantStatus to SUSPENDED
    try {
      const clerkUser = await clerkClient.users.getUser(merchant.clerkId);
      const existingMetadata = clerkUser.publicMetadata || {};
      
      await clerkClient.users.updateUser(merchant.clerkId, {
        publicMetadata: {
          ...existingMetadata,
          merchantStatus: "SUSPENDED",
          // Keep the merchant role but mark as suspended
          role: existingMetadata.role || undefined,
        },
      });

      logger.info('Merchant suspended and Clerk metadata updated', {
        requestId: req.requestId,
        merchantId: merchant._id,
        clerkId: merchant.clerkId,
        suspendedBy: adminId,
      });
    } catch (clerkError) {
      logger.error('Error updating Clerk metadata on suspension', {
        requestId: req.requestId,
        error: clerkError.message,
        clerkId: merchant.clerkId,
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

    if (merchant.status !== "SUSPENDED") {
      return sendError(res, {
        message: "Merchant is not suspended",
        code: 'NOT_SUSPENDED',
        statusCode: 400,
      });
    }

    // Restore merchant to approved status
    merchant.status = "APPROVED";
    merchant.suspensionReason = undefined;
    merchant.suspendedAt = undefined;
    await merchant.save();

    logger.info('Merchant unsuspended', {
      requestId: req.requestId,
      merchantId: merchant._id,
      clerkId: merchant.clerkId,
      unsuspendedBy: adminId,
    });

    // Send email notification to merchant
    try {
      await sendMerchantUnsuspensionEmail({
        to: merchant.businessEmail,
        businessName: merchant.businessName,
      });
      logger.info('Unsuspension email sent to merchant', {
        requestId: req.requestId,
        merchantId: merchant._id,
        email: merchant.businessEmail,
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
        body: `تم إلغاء تعليق حسابك التجاري "${merchant.businessName}". يمكنك الآن متابعة نشاطك التجاري بشكل طبيعي.`,
        userId: merchant.clerkId,
        read: false,
      });
      logger.info('Unsuspension notification created', {
        requestId: req.requestId,
        merchantId: merchant._id,
        clerkId: merchant.clerkId,
      });
    } catch (notifyError) {
      logger.error('Failed to create unsuspension notification', {
        requestId: req.requestId,
        merchantId: merchant._id,
        error: notifyError.message,
      });
      // Don't fail the request if notification fails
    }

    // Update Clerk user's publicMetadata to restore merchantStatus to APPROVED
    try {
      const clerkUser = await clerkClient.users.getUser(merchant.clerkId);
      const existingMetadata = clerkUser.publicMetadata || {};
      
      await clerkClient.users.updateUser(merchant.clerkId, {
        publicMetadata: {
          ...existingMetadata,
          role: "merchant",
          merchantStatus: "APPROVED",
        },
      });

      logger.info('Merchant unsuspended and Clerk metadata updated', {
        requestId: req.requestId,
        merchantId: merchant._id,
        clerkId: merchant.clerkId,
        unsuspendedBy: adminId,
      });
    } catch (clerkError) {
      logger.error('Error updating Clerk metadata on unsuspension', {
        requestId: req.requestId,
        error: clerkError.message,
        clerkId: merchant.clerkId,
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
      clerkId: merchant.clerkId,
      businessName: merchant.businessName,
      status: merchant.status,
      deletedBy: adminId,
    });

    // Delete the merchant
    await Merchant.findByIdAndDelete(id);

    logger.info('Merchant deleted successfully', {
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

    const merchant = await Merchant.findOne({ clerkId: userId });

    if (!merchant) {
      return res.status(404).json({ message: "Merchant profile not found" });
    }

    const { businessName, businessDescription, businessEmail, businessPhone, businessAddress } = req.body;

    // Update allowed fields
    if (businessName) merchant.businessName = businessName;
    if (businessDescription !== undefined) merchant.businessDescription = businessDescription;
    if (businessEmail) merchant.businessEmail = businessEmail;
    if (businessPhone !== undefined) merchant.businessPhone = businessPhone;
    if (businessAddress !== undefined) merchant.businessAddress = businessAddress;

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

