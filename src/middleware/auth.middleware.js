import { requireAuth, clerkClient, getAuth } from '@clerk/express';
import logger from '../lib/logger.js';
import { sendError, sendUnauthorized, sendForbidden } from '../lib/response.js';

/**
 * Authentication middleware that works with both web sessions and mobile app Bearer tokens
 * Mobile apps should send: Authorization: Bearer <clerk-session-token>
 * Clerk's requireAuth() automatically handles Bearer tokens from the Authorization header
 */
export const isAuthenticated = (req, res, next) => {
  // Use requireAuth directly - it's a factory function that returns middleware
  const authMiddleware = requireAuth();

  try {
    authMiddleware(req, res, (err) => {
      if (err) {
        logger.warn('Authentication failed', { requestId: req.requestId, error: err.message });
        return sendUnauthorized(res, 'Authentication required');
      }
      
      if (!req.auth || !req.auth.userId) {
        return sendUnauthorized(res, 'Authentication required');
      }

      next();
    });
  } catch (error) {
    logger.error('Error in authentication middleware', { error: error.message });
    return sendUnauthorized(res, 'Authentication required');
  }
};

export const isAdmin = async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    
    if (!userId) {
      return sendUnauthorized(res, 'Authentication required');
    }

    // 🏎️ Priority 1: Check session claims directly (fastest)
    const roleFromClaim = req.auth.sessionClaims?.publicMetadata?.role;
    
    if (roleFromClaim === 'admin' || roleFromClaim === 'support') {
      req.adminUser = { userId, role: roleFromClaim };
      return next();
    }

    // 🐌 Priority 2: Fallback to Clerk API (only if claims are missing)
    try {
      const user = await clerkClient.users.getUser(userId);
      const userRole = user.publicMetadata?.role;

      if (userRole === 'admin' || userRole === 'support') {
        req.adminUser = {
          userId,
          email: user.emailAddresses?.[0]?.emailAddress,
          role: userRole,
        };
        return next();
      }
      
      return sendForbidden(res, 'Admins only');
    } catch (clerkError) {
      logger.error('Clerk API error during admin check', { userId, error: clerkError.message });
      return sendError(res, { message: 'Authentication service error', code: 'CLERK_ERROR', statusCode: 503 });
    }
  } catch (error) {
    logger.error('Unexpected error in isAdmin middleware', { error: error.message });
    return sendError(res, { message: 'Server error during authorization' });
  }
};
