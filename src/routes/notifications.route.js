import express from 'express';
import { savePushToken , sendPushNotification } from '../controllers/notification.controller.js';

const router = express.Router();

router.post('/save', savePushToken);
router.post('/send', sendPushNotification);

export default router;
