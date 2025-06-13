import express from "express";
import {
  getCart,
  updateCart,
  addToCart,
} from "../controllers/cart.controller.js";

import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();
router.post("/add", addToCart);
router.get("/", isAuthenticated, getCart);
router.put("/update", isAuthenticated, updateCart);

export default router;
