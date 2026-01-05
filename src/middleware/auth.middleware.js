import { requireAuth, clerkClient } from '@clerk/express';
import logger from '../lib/logger.js';

export const isAuthenticated = requireAuth(); // يحمي الراوت

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
