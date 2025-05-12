import express from 'express'
import {
    getCart,
    createCart,
    updateCart,
    deleteCart
} from '../controllers/cart.controller.js'

import { isAuthenticated } from '../middleware/auth.middleware.js'

const router = express.Router()

router.get('/cart', isAuthenticated, getCart)

router.post('/cart', isAuthenticated, createCart)

router.put('/cart', isAuthenticated, updateCart)

router.delete('/cart', isAuthenticated, deleteCart)

export default router
