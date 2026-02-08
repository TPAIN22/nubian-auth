import { Router } from "express";
import { requireAuth } from "@clerk/express";
import { getLatestRates, refreshRates } from "../controllers/fx.controller.js";
import { isAdmin } from "../middleware/auth.middleware.js";

const router = Router();

/**
 * Exchange rates routes
 */

// GET /fx/latest - Get latest exchange rates (public for debugging/health)
router.get("/latest", getLatestRates);

// POST /admin/fx/refresh - Manually refresh exchange rates (admin only)
// Note: This route should be mounted under /admin or validated separately
router.post("/refresh", requireAuth(), isAdmin, refreshRates);

export default router;
