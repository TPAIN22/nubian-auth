import express from 'express'
import { getReviews, getReviewById, createReview, updateReview, deleteReview, getAllReviews } from '../controllers/review.controller.js'
import { isAuthenticated } from '../middleware/auth.middleware.js'

const router = express.Router()

router.get('/all', getAllReviews)
router.get('/', getReviews)
router.get('/:id', getReviewById)
router.post('/', isAuthenticated, createReview)
router.put('/:id', isAuthenticated, updateReview)
router.delete('/:id', isAuthenticated, deleteReview)

export default router
