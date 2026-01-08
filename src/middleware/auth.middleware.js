import { requireAuth, clerkClient } from '@clerk/express';
import logger from '../lib/logger.js';

/**
 * Authentication middleware that works with both web sessions and mobile app Bearer tokens
 * Mobile apps should send: Authorization: Bearer <clerk-session-token>
 * Clerk's requireAuth() automatically handles Bearer tokens from the Authorization header
 */
export const isAuthenticated = (req, res, next) => {
  logger.info('Authentication middleware called', {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    path: req.path,
    originalUrl: req.originalUrl,
    hasAuthHeader: !!req.headers.authorization,
    authHeaderPrefix: req.headers.authorization?.substring(0, 20),
  });

  // Store the original end/send methods to detect if response was sent
  const originalEnd = res.end;
  const originalJson = res.json;
  let responseSent = false;

  // Override res.end to detect if response was sent by requireAuth
  res.end = function(...args) {
    responseSent = true;
    return originalEnd.apply(this, args);
  };

  res.json = function(...args) {
    responseSent = true;
    return originalJson.apply(this, args);
  };

  // Use requireAuth middleware with proper error handling
  const authMiddleware = requireAuth({
    // This ensures proper error handling for mobile apps
    // Clerk will automatically extract Bearer tokens from Authorization header
  });

  // Wrap requireAuth to catch errors and return proper status codes
  try {
    return authMiddleware(req, res, (err) => {
      // Restore original methods
      res.end = originalEnd;
      res.json = originalJson;

      // If response was already sent by requireAuth, don't do anything
      if (responseSent) {
        logger.info('Response already sent by requireAuth', {
          requestId: req.requestId,
          url: req.url,
        });
        return;
      }

      if (err) {
        logger.warn('Authentication failed (error in next)', {
          requestId: req.requestId,
          error: err.message,
          errorName: err.name,
          statusCode: err.statusCode || err.status,
          url: req.url,
          hasAuthHeader: !!req.headers.authorization,
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        });
        // Return proper 401 instead of letting it become 404
        return res.status(401).json({ 
          message: "Authentication required.",
          code: "UNAUTHORIZED"
        });
      }
      
      // Check if req.auth exists (Clerk should populate this)
      if (!req.auth || !req.auth.userId) {
        logger.warn('Authentication passed but no userId found', {
          requestId: req.requestId,
          hasAuth: !!req.auth,
          authKeys: req.auth ? Object.keys(req.auth) : [],
          url: req.url,
        });
        return res.status(401).json({ 
          message: "Authentication required.",
          code: "UNAUTHORIZED"
        });
      }

      logger.info('Authentication successful', {
        requestId: req.requestId,
        userId: req.auth.userId,
        url: req.url,
      });
      next();
    });
  } catch (error) {
    // Restore original methods
    res.end = originalEnd;
    res.json = originalJson;

    logger.error('Error in authentication middleware', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
      url: req.url,
    });

    if (!responseSent) {
      return res.status(401).json({ 
        message: "Authentication required.",
        code: "UNAUTHORIZED"
      });
    }
  }
};

export const isAdmin = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const user = await clerkClient.users.getUser(userId);

    if (user.publicMetadata.role !== 'admin') {
      logger.warn('Unauthorized admin access attempt', {
        requestId: req.requestId,
        userId: userId,
        url: req.url,
      });
      return res.status(403).json({ message: 'Admins only' });
    }

    next();
  } catch (error) {
    logger.error('Error in isAdmin middleware', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: 'Server error' });
  }
};
