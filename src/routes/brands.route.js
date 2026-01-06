import express from 'express'
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js'
import { getmerchant, getBrandById, createBrand, updateBrand, deleteBrand } from '../controllers/brand.controller.js'
const router = express.Router()
import dotenv from 'dotenv'

dotenv.config()

router.get('/', getmerchant)
router.get('/:id', getBrandById)
router.post('/', isAuthenticated, isAdmin, createBrand)
router.put('/:id', isAuthenticated, isAdmin, updateBrand)
router.delete('/:id', isAuthenticated, isAdmin, deleteBrand)

export default router
