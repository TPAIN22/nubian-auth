import Merchant from "../models/merchant.model.js";
import Notify from "../models/notify.model.js";
import { clerkClient } from '@clerk/express';
import logger from '../lib/logger.js';
import { getAuth } from "@clerk/express";
import { sendSuccess, sendError, sendCreated, sendNotFound, sendUnauthorized, sendForbidden } from '../lib/response.js';
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
      return res.status(401).json({ message: "Unauthorized" });
    }

    const merchant = await Merchant.findOne({ clerkId: userId });

    if (!merchant) {
      return res.status(404).json({ 
        message: "No merchant application found",
        hasApplication: false 
      });
    }

    res.status(200).json({
      merchant,
      hasApplication: true,
    });
  } catch (error) {
    logger.error('Error getting merchant status', {
      requestId: req.requestId,
      error: error.message,
    });
    res.status(500).json({ message: error.message });
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

    res.status(200).json(merchants);
  } catch (error) {
    logger.error('Error getting all merchants', {
      requestId: req.requestId,
      error: error.message,
    });
    res.status(500).json({ message: error.message });
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
      return res.status(404).json({ message: "Merchant not found" });
    }

    res.status(200).json(merchant);
  } catch (error) {
    logger.error('Error getting merchant by ID', {
      requestId: req.requestId,
      error: error.message,
    });
    res.status(500).json({ message: error.message });
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
      return res.status(404).json({ message: "Merchant not found" });
    }

    if (merchant.status === "APPROVED") {
      return res.status(400).json({ message: "Merchant is already approved" });
    }

    // Update merchant status
    merchant.status = "APPROVED";
    merchant.approvedAt = new Date();
    merchant.approvedBy = adminId;
    await merchant.save();

    // Update Clerk user's publicMetadata to set role to "merchant"
    try {
      await clerkClient.users.updateUser(merchant.clerkId, {
        publicMetadata: {
          role: "merchant",
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

    res.status(200).json({
      message: "Merchant approved successfully",
      merchant,
    });
  } catch (error) {
    logger.error('Error approving merchant', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: error.message });
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
      return res.status(404).json({ message: "Merchant not found" });
    }

    if (merchant.status === "REJECTED") {
      return res.status(400).json({ message: "Merchant is already rejected" });
    }

    // Update merchant status
    merchant.status = "REJECTED";
    merchant.rejectionReason = rejectionReason || "Application rejected by admin";
    merchant.approvedBy = adminId;
    await merchant.save();

    logger.info('Merchant rejected', {
      requestId: req.requestId,
      merchantId: merchant._id,
      clerkId: merchant.clerkId,
      rejectedBy: adminId,
      reason: rejectionReason,
    });

    res.status(200).json({
      message: "Merchant application rejected",
      merchant,
    });
  } catch (error) {
    logger.error('Error rejecting merchant', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get current merchant's profile (Merchant only)
 */
export const getMyMerchantProfile = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const merchant = await Merchant.findOne({ clerkId: userId });

    if (!merchant) {
      return res.status(404).json({ message: "Merchant profile not found" });
    }

    res.status(200).json(merchant);
  } catch (error) {
    logger.error('Error getting merchant profile', {
      requestId: req.requestId,
      error: error.message,
    });
    res.status(500).json({ message: error.message });
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

    return sendSuccess(res, merchant, "Merchant suspended successfully");
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

    return sendSuccess(res, merchant, "Merchant unsuspended successfully");
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

    return sendSuccess(res, { id }, "Merchant deleted successfully");
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

    res.status(200).json({
      message: "Merchant profile updated successfully",
      merchant,
    });
  } catch (error) {
    logger.error('Error updating merchant profile', {
      requestId: req.requestId,
      error: error.message,
    });
    res.status(500).json({ message: error.message });
  }
};

