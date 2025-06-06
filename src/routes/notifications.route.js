import express from 'express';
import { savePushToken , sendPushNotification , getNotifications} from '../controllers/notification.controller.js';
import { isAdmin, isAuthenticated } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/save', savePushToken);
router.post('/send',isAuthenticated,isAdmin ,sendPushNotification);
router.get('/user', getNotifications);

export default router;
