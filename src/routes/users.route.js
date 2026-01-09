import express from 'express'
import { getAllUsers, syncUser, getCurrentUser } from '../controllers/user.controller.js'
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js'

const router = express.Router()

// Public sync endpoint - allows users to sync their account if webhook fails
// Protected by authentication (user must be logged in to sync themselves)
router.post('/sync', isAuthenticated, syncUser)

// Get current user profile
router.get('/me', isAuthenticated, getCurrentUser)

// Admin-only: Get all users
router.get('/', isAuthenticated, isAdmin, getAllUsers)

//router.put('/:id', isAuthenticated, isAdmin, updateUSer)
//router.delete('/:id', isAuthenticated, isAdmin, deleteUser)

export default router
