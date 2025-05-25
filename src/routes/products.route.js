import express from 'express'
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js'
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct
} from '../controllers/products.controller.js'

const router = express.Router()

router.get('/', getProducts)
router.get('/:id', getProductById)
router.post('/', isAuthenticated,isAdmin, createProduct)
router.put('/:id', isAuthenticated, isAdmin, updateProduct)
router.delete('/:id', isAuthenticated, isAdmin, deleteProduct)

export default router