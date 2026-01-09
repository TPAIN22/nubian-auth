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
  const startTime = Date.now();
  
  try {
    // Log entry point with request context
    logger.info('Admin authorization check started', {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      path: req.path,
      hasAuth: !!req.auth,
      userId: req.auth?.userId || null,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('user-agent'),
    });

    const userId = req.auth?.userId;
    
    if (!userId) {
      logger.warn('Admin check failed: Missing userId in req.auth', {
        requestId: req.requestId,
        method: req.method,
        url: req.url,
        hasAuth: !!req.auth,
        authKeys: req.auth ? Object.keys(req.auth) : [],
        durationMs: Date.now() - startTime,
      });
      return res.status(401).json({ 
        success: false,
        message: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
    }

    // Attempt to fetch user from Clerk with detailed logging
    let user;
    try {
      logger.debug('Fetching user from Clerk for admin check', {
        requestId: req.requestId,
        userId: userId,
      });
      
      user = await clerkClient.users.getUser(userId);
      
      logger.debug('Clerk user fetched successfully', {
        requestId: req.requestId,
        userId: userId,
        hasPublicMetadata: !!user.publicMetadata,
        role: user.publicMetadata?.role || 'none',
        email: user.emailAddresses?.[0]?.emailAddress || 'none',
        durationMs: Date.now() - startTime,
      });
    } catch (clerkError) {
      logger.error('Clerk API error during admin check', {
        requestId: req.requestId,
        userId: userId,
        error: clerkError.message,
        errorName: clerkError.name,
        errorCode: clerkError.code || clerkError.statusCode,
        errorStatus: clerkError.status,
        stack: process.env.NODE_ENV === 'development' ? clerkError.stack : undefined,
        durationMs: Date.now() - startTime,
      });
      
      return res.status(503).json({ 
        success: false,
        message: 'Authentication service temporarily unavailable',
        code: 'CLERK_ERROR',
        requestId: req.requestId,
      });
    }

    // Check admin role
    const userRole = user.publicMetadata?.role;
    const isUserAdmin = userRole === 'admin';

    if (!isUserAdmin) {
      logger.warn('Unauthorized admin access attempt', {
        requestId: req.requestId,
        userId: userId,
        userRole: userRole || 'none',
        userEmail: user.emailAddresses?.[0]?.emailAddress || 'unknown',
        method: req.method,
        url: req.url,
        path: req.path,
        ip: req.ip || req.connection?.remoteAddress,
        durationMs: Date.now() - startTime,
      });
      
      return res.status(403).json({ 
        success: false,
        message: 'Admins only',
        code: 'FORBIDDEN',
        requestId: req.requestId,
      });
    }

    // Admin access granted
    logger.info('Admin authorization successful', {
      requestId: req.requestId,
      userId: userId,
      userEmail: user.emailAddresses?.[0]?.emailAddress || 'unknown',
      method: req.method,
      url: req.url,
      path: req.path,
      durationMs: Date.now() - startTime,
    });

    // Attach admin user info to request for downstream use
    req.adminUser = {
      userId: userId,
      email: user.emailAddresses?.[0]?.emailAddress,
      role: userRole,
    };

    next();
  } catch (error) {
    logger.error('Unexpected error in isAdmin middleware', {
      requestId: req.requestId,
      error: error.message,
      errorName: error.name,
      errorCode: error.code,
      stack: error.stack,
      method: req.method,
      url: req.url,
      userId: req.auth?.userId || null,
      durationMs: Date.now() - startTime,
    });
    
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      code: 'INTERNAL_ERROR',
      requestId: req.requestId,
    });
  }
};
