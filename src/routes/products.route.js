import express from 'express'
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js'
import { isApprovedMerchant, isAdminOrApprovedMerchant } from '../middleware/merchant.middleware.js'
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getMerchantProducts,
  getAllProductsAdmin,
  toggleProductActive,
  restoreProduct,
  hardDeleteProduct,
  updateProductRanking,
  exploreProducts,
} from '../controllers/products.controller.js'
import { validateProductCreate, validateProductUpdate } from '../middleware/validators/product.validator.js'
import { validatePagination } from '../middleware/validators/pagination.validator.js'
import { validateCategoryFilter, validateMerchantFilter } from '../middleware/validators/query.validator.js'
import { validateObjectId, handleValidationErrors } from '../middleware/validation.middleware.js'

const router = express.Router()

// Public/Merchant routes (order matters - more specific routes first)
router.get('/', validatePagination, validateCategoryFilter, validateMerchantFilter, getProducts)
router.get('/explore', validatePagination, exploreProducts)
router.get('/merchant/my-products', isAuthenticated, isApprovedMerchant, validatePagination, validateCategoryFilter, getMerchantProducts)
router.get('/:id', ...validateObjectId('id'), handleValidationErrors, getProductById)

// Product creation/update/delete (merchant and admin)
router.post('/', isAuthenticated, isAdminOrApprovedMerchant, validateProductCreate, createProduct)
router.put('/:id', isAuthenticated, ...validateObjectId('id'), handleValidationErrors, validateProductUpdate, updateProduct)
router.delete('/:id', isAuthenticated, ...validateObjectId('id'), handleValidationErrors, deleteProduct)

// Admin-only routes for managing all products
router.get('/admin/all', isAuthenticated, isAdmin, validatePagination, validateCategoryFilter, validateMerchantFilter, getAllProductsAdmin)
router.patch('/admin/:id/toggle-active', isAuthenticated, isAdmin, ...validateObjectId('id'), handleValidationErrors, toggleProductActive)
router.patch('/admin/:id/ranking', isAuthenticated, isAdmin, ...validateObjectId('id'), handleValidationErrors, updateProductRanking)
router.patch('/admin/:id/restore', isAuthenticated, isAdmin, ...validateObjectId('id'), handleValidationErrors, restoreProduct)
router.delete('/admin/:id/hard-delete', isAuthenticated, isAdmin, ...validateObjectId('id'), handleValidationErrors, hardDeleteProduct)

export default router