import { requireAuth, clerkClient } from '@clerk/express';
import logger from '../lib/logger.js';

/**
 * Authentication middleware that works with both web sessions and mobile app Bearer tokens
 * Mobile apps should send: Authorization: Bearer <clerk-session-token>
 * Clerk's requireAuth() automatically handles Bearer tokens from the Authorization header
 */
export const isAuthenticated = async (req, res, next) => {
  logger.info('Authentication middleware called', {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    path: req.path,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
    hasAuthHeader: !!req.headers.authorization,
    authHeaderPrefix: req.headers.authorization?.substring(0, 20),
    routeMatched: true, // This confirms the route was matched
  });

  // Store the original end/send methods to detect if response was sent
  const originalEnd = res.end;
  const originalJson = res.json;
  const originalSend = res.send;
  let responseSent = false;

  // Override response methods to detect if response was sent by requireAuth
  res.end = function(...args) {
    responseSent = true;
    return originalEnd.apply(this, args);
  };

  res.json = function(...args) {
    responseSent = true;
    return originalJson.apply(this, args);
  };

  res.send = function(...args) {
    responseSent = true;
    return originalSend.apply(this, args);
  };

  // Use requireAuth directly - it's a factory function that returns middleware
  // IMPORTANT: requireAuth handles Bearer tokens from Authorization header automatically
  const authMiddleware = requireAuth({
    // This ensures proper error handling for mobile apps
    // Clerk will automatically extract Bearer tokens from Authorization header
  });

  // Call the middleware - it will handle req, res, and call next() or send error response
  try {
    authMiddleware(req, res, (err) => {
      // Restore original methods first
      res.end = originalEnd;
      res.json = originalJson;
      res.send = originalSend;

      // If response was already sent by requireAuth, don't send another
      if (responseSent || res.headersSent) {
        logger.info('Response already sent by requireAuth', {
          requestId: req.requestId,
          url: req.url,
          method: req.method,
          path: req.path,
          status: responseSent ? 'sent' : 'headers_sent',
        });
        return; // Response already sent, exit
      }

      // Handle authentication errors
      if (err) {
        logger.warn('Authentication failed', {
          requestId: req.requestId,
          error: err.message,
          errorName: err.name,
          statusCode: err.statusCode || err.status,
          url: req.url,
          method: req.method,
          path: req.path,
          hasAuthHeader: !!req.headers.authorization,
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        });
        // Send standardized 401 error response
        return res.status(401).json({ 
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
            requestId: req.requestId || 'unknown',
          },
          timestamp: new Date().toISOString(),
        });
      }
      
      // Verify req.auth was populated by Clerk
      if (!req.auth || !req.auth.userId) {
        logger.warn('Authentication passed but no userId found', {
          requestId: req.requestId,
          hasAuth: !!req.auth,
          authKeys: req.auth ? Object.keys(req.auth) : [],
          url: req.url,
          method: req.method,
          path: req.path,
        });
        return res.status(401).json({ 
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
            requestId: req.requestId || 'unknown',
          },
          timestamp: new Date().toISOString(),
        });
      }

      logger.info('Authentication successful', {
        requestId: req.requestId,
        userId: req.auth.userId,
        url: req.url,
        method: req.method,
        path: req.path,
      });
      
      // Authentication successful, proceed to next middleware/route handler
      next();
    });
  } catch (error) {
    // Restore original methods
    res.end = originalEnd;
    res.json = originalJson;
    res.send = originalSend;

    logger.error('Error in authentication middleware', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
      url: req.url,
    });

    // ALWAYS send a response to prevent 404
    if (!responseSent && !res.headersSent) {
      return res.status(401).json({ 
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required.",
          requestId: req.requestId || 'unknown',
        },
        timestamp: new Date().toISOString(),
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
