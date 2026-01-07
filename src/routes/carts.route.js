import express from "express";
import {
  getCart,
  updateCart,
  addToCart,
  removeFromCart,
} from "../controllers/cart.controller.js";

import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();
// All cart routes require authentication for security
router.post("/add", isAuthenticated, addToCart);
router.get("/", isAuthenticated, getCart);
router.put("/update", isAuthenticated, updateCart);
router.delete("/remove", isAuthenticated, removeFromCart);

export default router;
