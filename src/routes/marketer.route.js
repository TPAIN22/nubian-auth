import express from 'express';
import {
    createMarketer,
    getMarketers,
    getMarketerById,
    updateMarketer,
    deleteMarketer,
    getMarketerStats
} from '../controllers/marketer.controller.js';
import { isAdmin, isAuthenticated } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/', isAuthenticated , isAdmin , createMarketer);
router.get('/', isAuthenticated , isAdmin ,getMarketers);
router.get('/:id',isAuthenticated , isAdmin , getMarketerById);
router.put('/:id',isAuthenticated , isAdmin , updateMarketer);
router.delete('/:id',isAuthenticated , isAdmin , deleteMarketer);
router.get('/:id/stats', isAuthenticated , isAdmin , getMarketerStats);


export default router;
