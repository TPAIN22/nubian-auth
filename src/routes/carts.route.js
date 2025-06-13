import express from "express";
import {
  getCart,
  updateCart,
  addToCart,
  removeFromCart,
} from "../controllers/cart.controller.js";

import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();
router.post("/add", addToCart);
router.get("/", isAuthenticated, getCart);
router.put("/update", isAuthenticated, updateCart);
router.delete("/remove", isAuthenticated, removeFromCart);

export default router;
