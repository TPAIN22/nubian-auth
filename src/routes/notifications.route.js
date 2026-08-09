import express from 'express';
import { createLimiter } from '../lib/rateLimit/index.js';
import { isAdmin, isAuthenticated } from '../middleware/auth.middleware.js';
import { isMerchant, isApprovedMerchant, requireMerchantPermission } from '../middleware/merchant.middleware.js';
import { PERMISSIONS } from '../lib/merchantPermissions.js';
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
  saveNotification,
} from '../controllers/notification.controller.js';

const router = express.Router();

// 5 token registrations per minute per IP — prevents push token collection flooding
const tokenLimiter = createLimiter({
  name: 'push-token',
  windowMs: 60 * 1000,
  limit: 5,
  message: 'Too many token registration requests.',
});

// Push token management — anonymous allowed by design (supports pre-login devices)
router.post('/tokens',          tokenLimiter, savePushToken);
// Deliberately ungated beyond membership: registering your own device is
// something every member of a store does, staff included.
router.post('/tokens/merchant', isAuthenticated, isApprovedMerchant, saveMerchantPushToken);

// Notification retrieval
router.get('/',            isAuthenticated, getNotifications);
router.get('/unread',      isAuthenticated, getUnreadCount);
router.get('/preferences', isAuthenticated, getPreferences);

// Notification actions
router.patch('/:notificationId/read', isAuthenticated, markAsRead);
router.post('/mark-read',             isAuthenticated, markMultipleAsRead);

// Preferences management
router.put('/preferences', isAuthenticated, updatePreferences);

// Test endpoint — admin only; prevents users from spamming test push notifications
router.post('/test', isAuthenticated, isAdmin, sendTestNotification);

// Broadcast — admin only
router.post('/broadcast', isAuthenticated, isAdmin, sendBroadcast);
// Marketing — approved merchants only (not all authenticated users)
router.post('/marketing',  isAuthenticated, isApprovedMerchant, requireMerchantPermission(PERMISSIONS.MARKETING_SEND), sendMarketingNotification);

// Legacy endpoints
router.post('/save', tokenLimiter, savePushToken);
router.post('/send', isAuthenticated, isAdmin, sendBroadcast);

export default router;
