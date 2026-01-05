import { clerkClient } from '@clerk/express';
import Merchant from '../models/merchant.model.js';
import logger from '../lib/logger.js';

/**
 * Middleware to check if user is a merchant (role check only)
 */
export const isMerchant = async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await clerkClient.users.getUser(userId);

    if (user.publicMetadata?.role !== 'merchant') {
      logger.warn('Unauthorized merchant access attempt', {
        requestId: req.requestId,
        userId: userId,
        url: req.url,
        role: user.publicMetadata?.role,
      });
      return res.status(403).json({ message: 'Merchants only' });
    }

    next();
  } catch (error) {
    logger.error('Error in isMerchant middleware', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Middleware to check if user is an approved merchant
 * Checks both Clerk role and DB status
 */
export const isApprovedMerchant = async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Check Clerk role
    const user = await clerkClient.users.getUser(userId);

    if (user.publicMetadata?.role !== 'merchant') {
      logger.warn('Unauthorized merchant access attempt (wrong role)', {
        requestId: req.requestId,
        userId: userId,
        url: req.url,
        role: user.publicMetadata?.role,
      });
      return res.status(403).json({ message: 'Merchants only' });
    }

    // Check DB status
    const merchant = await Merchant.findOne({ clerkId: userId });

    if (!merchant) {
      logger.warn('Merchant not found in database', {
        requestId: req.requestId,
        userId: userId,
        url: req.url,
      });
      return res.status(403).json({ message: 'Merchant profile not found' });
    }

    if (merchant.status !== 'APPROVED') {
      logger.warn('Merchant access denied - not approved', {
        requestId: req.requestId,
        userId: userId,
        status: merchant.status,
        url: req.url,
      });
      return res.status(403).json({ 
        message: 'Merchant application not approved',
        status: merchant.status 
      });
    }

    // Attach merchant to request for use in controllers
    req.merchant = merchant;

    next();
  } catch (error) {
    logger.error('Error in isApprovedMerchant middleware', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: 'Server error' });
  }
};

