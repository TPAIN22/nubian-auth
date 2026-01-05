import express from 'express'
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js'
import { isApprovedMerchant } from '../middleware/merchant.middleware.js'
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getMerchantProducts
} from '../controllers/products.controller.js'
import { validateProductCreate, validateProductUpdate } from '../middleware/validators/product.validator.js'
import { validatePagination } from '../middleware/validators/pagination.validator.js'
import { validateCategoryFilter, validateMerchantFilter } from '../middleware/validators/query.validator.js'
import { validateObjectId } from '../middleware/validation.middleware.js'

const router = express.Router()

router.get('/', validatePagination, validateCategoryFilter, validateMerchantFilter, getProducts)
router.get('/merchant/my-products', isAuthenticated, isApprovedMerchant, validatePagination, validateCategoryFilter, getMerchantProducts)
router.get('/:id', ...validateObjectId('id'), getProductById)
// Allow both admin and approved merchants to create products
router.post('/', isAuthenticated, validateProductCreate, createProduct)
// Allow both admin and approved merchants to update products (ownership checked in controller)
router.put('/:id', isAuthenticated, ...validateObjectId('id'), validateProductUpdate, updateProduct)
// Allow both admin and approved merchants to delete products (ownership checked in controller)
router.delete('/:id', isAuthenticated, ...validateObjectId('id'), deleteProduct)

export default router