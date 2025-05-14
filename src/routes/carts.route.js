import express from "express";
import {
  getCart,
  updateCart,
  deleteCart,
  addToCart,
} from "../controllers/cart.controller.js";

import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = express.Router();
router.post("/add", addToCart);
router.get("/", isAuthenticated, getCart);
router.put("/update", isAuthenticated, updateCart);

router.delete("/delete", isAuthenticated, deleteCart);

export default router;
