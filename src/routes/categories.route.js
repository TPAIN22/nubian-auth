import express from 'express'
import { getCategories, getCategoryById, createCategory, updateCategory, deleteCategory } from '../controllers/category.controller.js'
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js'
import { isAdminOrApprovedMerchant, requireMerchantPermission } from '../middleware/merchant.middleware.js'
import { PERMISSIONS } from '../lib/merchantPermissions.js'

const router = express.Router()

router.get('/', getCategories)
router.get('/:id', getCategoryById)
// Creating a category is catalogue work, so it rides on products:write.
router.post('/', isAuthenticated, isAdminOrApprovedMerchant, requireMerchantPermission(PERMISSIONS.PRODUCTS_WRITE), createCategory)
router.put('/:id', isAuthenticated, isAdmin, updateCategory)
router.delete('/:id', isAuthenticated, isAdmin, deleteCategory)

export default router
