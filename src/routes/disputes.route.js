import express from "express";
import { body, param } from "express-validator";
import { resolveDispute } from "../controllers/dispute.controller.js";
import { validationResult } from "express-validator";

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors: errors.array(),
    });
  }
  next();
};

// POST /disputes/:id/resolve
router.post(
  "/:id/resolve",
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
