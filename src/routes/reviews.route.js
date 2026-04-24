import express from 'express';
import { getReviews, getReviewById, createReview, updateReview, deleteReview, getAllReviews } from '../controllers/review.controller.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';
import { validateObjectId, handleValidationErrors } from '../middleware/validation.middleware.js';

const router = express.Router();

// Admin-only: full review list with pagination (was unbounded public dump)
router.get('/all', isAuthenticated, isAdmin, getAllReviews);

router.get('/',    getReviews);
router.get('/:id', ...validateObjectId('id'), handleValidationErrors, getReviewById);

router.post('/',   isAuthenticated, createReview);

// ObjectId validation prevents Mongoose CastErrors; controller enforces ownership
router.put('/:id',    isAuthenticated, ...validateObjectId('id'), handleValidationErrors, updateReview);
router.delete('/:id', isAuthenticated, ...validateObjectId('id'), handleValidationErrors, deleteReview);

export default router;
