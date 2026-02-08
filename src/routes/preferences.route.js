import { Router } from "express";
import { requireAuth } from "@clerk/express";
import {
  updatePreferences,
  getPreferences,
} from "../controllers/preferences.controller.js";

const router = Router();

/**
 * User preferences routes (authenticated)
 * For managing user's country and currency preferences
 */

// GET /me/preferences - Get current user's preferences
router.get("/", requireAuth(), getPreferences);

// PUT /me/preferences - Update current user's preferences
router.put("/", requireAuth(), updatePreferences);

export default router;
