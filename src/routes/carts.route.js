import express from "express";
import {
  getCart,
  updateCart,
  addToCart,
  removeFromCart,
} from "../controllers/cart.controller.js";

import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();

// Test route to verify routing is working (remove in production)
if (process.env.NODE_ENV !== 'production') {
  router.get("/test", (req, res) => {
    res.json({ message: "Cart routes are working", timestamp: new Date().toISOString() });
  });
}

// All cart routes require authentication for security
router.post("/add", isAuthenticated, addToCart);
router.get("/", isAuthenticated, getCart);
router.put("/update", isAuthenticated, updateCart);
router.delete("/remove", isAuthenticated, removeFromCart);

export default router;
