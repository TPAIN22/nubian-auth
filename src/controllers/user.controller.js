import User from "../models/user.model.js";
import { clerkClient } from "@clerk/express";
import { getAuth } from "@clerk/express";
import logger from "../lib/logger.js";
import { sendSuccess, sendError, sendCreated, sendPaginated } from "../lib/response.js";
import { sendWelcomeEmail } from "../lib/mail.js";

// Fields exposed to clients. Excludes internal behaviour-tracking arrays
// (viewedProducts, cartEvents, searchKeywords, etc.) which are server-only intelligence.
const USER_PUBLIC_FIELDS = 'clerkId fullName emailAddress phone role countryCode currencyCode createdAt updatedAt';
const USER_ADMIN_FIELDS  = 'clerkId fullName emailAddress phone role isAdmin isDeleted deletedAt lastActive countryCode currencyCode createdAt updatedAt';

/**
 * Get or create user in MongoDB from Clerk
 * This endpoint allows the app to sync user data if webhook fails
 * It's idempotent and safe to call multiple times
 */
export const syncUser = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return sendError(res, {
        message: "Unauthorized - missing userId",
        statusCode: 401,
        code: "UNAUTHORIZED",
      });
    }

    logger.info('User sync requested', {
      requestId: req.requestId,
      clerkId: userId,
    });

    // Check if user already exists
    let user = await User.findOne({ clerkId: userId }).select(USER_PUBLIC_FIELDS).lean();
    const isNewUser = !user;
    
    if (user) {
      logger.info('User already exists in database', {
        requestId: req.requestId,
        clerkId: userId,
        userId: user._id,
      });
      return sendSuccess(res, {
        data: user,
        message: "User already synced",
      });
    }

    // Fetch user data from Clerk
    let clerkUser;
    try {
      clerkUser = await clerkClient.users.getUser(userId);
    } catch (clerkError) {
      logger.error('Failed to fetch user from Clerk', {
        requestId: req.requestId,
        clerkId: userId,
        error: clerkError.message,
      });
      return sendError(res, {
        message: "Failed to fetch user data",
        statusCode: 500,
        code: "CLERK_ERROR",
        details: process.env.NODE_ENV === 'development' ? clerkError.message : undefined,
      });
    }

    // Extract user data
    const firstName = clerkUser.firstName || '';
    const lastName = clerkUser.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim() || 
                     clerkUser.username || 
                     clerkUser.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 
                     'User';

    const userData = {
      clerkId: clerkUser.id,
      fullName: fullName,
      phone: clerkUser.phoneNumbers?.[0]?.phoneNumber || '',
      emailAddress: clerkUser.emailAddresses?.[0]?.emailAddress || '',
    };

    // Create user with upsert to handle race conditions
    user = await User.findOneAndUpdate(
      { clerkId: userId },
      userData,
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        select: USER_PUBLIC_FIELDS,
      }
    );

    logger.info('User synced successfully', {
      requestId: req.requestId,
      clerkId: userId,
      userId: user._id,
      emailAddress: user.emailAddress,
      isNewUser: isNewUser,
    });

    // Send welcome email for new users (non-blocking)
    if (isNewUser && user.emailAddress) {
      sendWelcomeEmail({
        to: user.emailAddress,
        userName: firstName || fullName.split(' ')[0] || 'there',
      })
        .then(() => {
          logger.info('Welcome email sent successfully', {
            requestId: req.requestId,
            userId: user._id,
            emailAddress: user.emailAddress,
          });
        })
        .catch((emailError) => {
          logger.error('Failed to send welcome email', {
            requestId: req.requestId,
            userId: user._id,
            emailAddress: user.emailAddress,
            error: emailError.message,
          });
        });
    }

    return sendCreated(res, user, "User synced successfully");
  } catch (error) {
    logger.error('Error syncing user', {
      requestId: req.requestId,
      error: error.message,
      errorName: error.name,
      errorCode: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

    // Handle duplicate key error (race condition)
    if (error.name === 'MongoServerError' && error.code === 11000) {
      // User was created by another request, fetch it
      try {
        const { userId } = getAuth(req);
        const existingUser = await User.findOne({ clerkId: userId }).select(USER_PUBLIC_FIELDS).lean();
        if (existingUser) {
          return sendSuccess(res, {
            data: existingUser,
            message: "User synced successfully (race condition handled)",
          });
        }
      } catch (fetchError) {
        logger.error('Failed to fetch user after duplicate key error', {
          requestId: req.requestId,
          error: fetchError.message,
        });
      }
      
      return sendError(res, {
        message: "User already exists (duplicate key error)",
        statusCode: 409,
        code: "DUPLICATE_ENTRY",
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      return sendError(res, {
        message: "Invalid user data",
        statusCode: 400,
        code: "VALIDATION_ERROR",
        details: error.message,
      });
    }

    // Generic error
    return sendError(res, {
      message: "Failed to sync user",
      statusCode: 500,
      code: "INTERNAL_ERROR",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * Get current user profile
 */
export const getCurrentUser = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return sendError(res, {
        message: "Unauthorized",
        statusCode: 401,
        code: "UNAUTHORIZED",
      });
    }

    const user = await User.findOne({ clerkId: userId }).select(USER_PUBLIC_FIELDS).lean();

    if (!user) {
      return sendError(res, {
        message: "User not found in database. Please sync your account.",
        statusCode: 404,
        code: "USER_NOT_FOUND",
      });
    }

    return sendSuccess(res, {
      data: user,
      message: "User retrieved successfully",
    });
  } catch (error) {
    logger.error('Error getting current user', {
      requestId: req.requestId,
      error: error.message,
    });
    return sendError(res, {
      message: "Failed to retrieve user",
      statusCode: 500,
      code: "INTERNAL_ERROR",
    });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find({ isDeleted: { $ne: true } })
        .select(USER_ADMIN_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments({ isDeleted: { $ne: true } }),
    ]);

    return sendPaginated(res, { data: users, page, limit, total, message: "Users retrieved successfully" });
  } catch (error) {
    logger.error('Error getting all users', { requestId: req.requestId, error: error.message });
    return sendError(res, { message: "Failed to retrieve users", statusCode: 500, code: "INTERNAL_ERROR" });
  }
};