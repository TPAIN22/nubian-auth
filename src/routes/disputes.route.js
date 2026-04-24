import express from "express";
import { body, param } from "express-validator";
import { resolveDispute } from "../controllers/dispute.controller.js";
import { handleValidationErrors } from "../middleware/validation.middleware.js";
import { isAuthenticated, isAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

// POST /disputes/:id/resolve — admin only: refunds and merchant balance mutations happen here
router.post(
  "/:id/resolve",
  isAuthenticated,
  isAdmin,
  [
    param("id").isMongoId().withMessage("Invalid Dispute ID"),
    body("resolution")
      .isIn(["refund_full", "refund_partial", "rejected"])
      .withMessage("Invalid resolution type"),
    body("adminNote").optional().isString(),
    body("approvedAmount").optional().isNumeric(),
    handleValidationErrors,
  ],
  resolveDispute
);

export default router;
