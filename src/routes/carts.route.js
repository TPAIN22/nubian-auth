import express from "express";
import {
  getCart,
  updateCart,
  deleteCart,
  addToCart,
} from "../controllers/cart.controller.js";

import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();
router.post("/cart/add", isAuthenticated, addToCart);
router.get("/cart", isAuthenticated, getCart);
router.put("/cart", isAuthenticated, updateCart);

router.delete("/cart", isAuthenticated, deleteCart);

export default router;
