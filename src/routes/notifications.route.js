import express from 'express';
import {
  savePushToken,
  saveMerchantPushToken,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markMultipleAsRead,
  getPreferences,
  updatePreferences,
  sendBroadcast,
  sendMarketingNotification,
  sendTestNotification,
  // Legacy endpoints
  saveNotification,
} from '../controllers/notification.controller.js';
import { isAdmin, isAuthenticated } from '../middleware/auth.middleware.js';
import { isMerchant } from '../middleware/merchant.middleware.js';

const router = express.Router();

// Push token management
router.post('/tokens', savePushToken); // Anonymous allowed - supports anonymous tokens
router.post('/tokens/merchant', isAuthenticated, isMerchant, saveMerchantPushToken);

// Notification retrieval
router.get('/', isAuthenticated, getNotifications);
router.get('/unread', isAuthenticated, getUnreadCount);
router.get('/preferences', isAuthenticated, getPreferences);

// Notification actions
router.patch('/:notificationId/read', isAuthenticated, markAsRead);
router.post('/mark-read', isAuthenticated, markMultipleAsRead);

// Preferences management
router.put('/preferences', isAuthenticated, updatePreferences);

// Test endpoint (for debugging)
router.post('/test', isAuthenticated, sendTestNotification);

// Broadcast and marketing (Admin/Merchant only)
router.post('/broadcast', isAuthenticated, isAdmin, sendBroadcast);
router.post('/marketing', isAuthenticated, sendMarketingNotification); // Allow merchants too

// Legacy endpoints (for backward compatibility)
router.post('/save', savePushToken); // Maps to savePushToken for compatibility
router.post('/send', isAuthenticated, isAdmin, sendBroadcast); // Legacy broadcast endpoint

export default router;
