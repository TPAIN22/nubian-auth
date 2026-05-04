import express from "express";
import {
  getCart,
  updateCart,
  addToCart,
  removeFromCart,
  applyCoupon,
  removeCoupon,
} from "../controllers/cart.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/",          isAuthenticated, getCart);
router.post("/add",      isAuthenticated, addToCart);
router.put("/update",    isAuthenticated, updateCart);
router.delete("/remove", isAuthenticated, removeFromCart);
router.post("/coupon",   isAuthenticated, applyCoupon);
router.delete("/coupon", isAuthenticated, removeCoupon);

export default router;
