 import express from 'express'
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
} from '../controllers/wishlist.controller.js'
import { isAuthenticated } from '../middleware/auth.middleware.js'

const router = express.Router()

// جلب المفضلة للمستخدم الحالي
router.get('/', isAuthenticated, getWishlist)

// إضافة منتج للمفضلة
router.post('/:productId', isAuthenticated, addToWishlist)

// حذف منتج من المفضلة
router.delete('/:productId', isAuthenticated, removeFromWishlist)

export default router
