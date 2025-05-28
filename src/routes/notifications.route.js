import express from 'express';
import { savePushToken } from '../controllers/pushToken.controller.js';

const router = express.Router();

router.post('/save', savePushToken);

export default router;
