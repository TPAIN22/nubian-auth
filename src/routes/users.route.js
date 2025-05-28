import express from 'express'
import { getAllUsers } from '../controllers/user.controller.js'
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js'

const router = express.Router()

router.get('/', isAuthenticated, isAdmin, getAllUsers)


//router.put('/:id', isAuthenticated, isAdmin, updateUSer)
//router.delete('/:id', isAuthenticated, isAdmin, deleteUser)

export default router
