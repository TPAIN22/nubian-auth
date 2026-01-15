import express from "express";
import {
  updateOrderStatus,
  getUserOrders,
  createOrder,
  getOrders,
  getOrderById,
  getMerchantOrders,
  getMerchantOrderStats,

  // ✅ NEW (add these in controller)
  approveBankakPayment,
  rejectBankakPayment,
  updatePaymentStatus,
} from "../controllers/order.controller.js";

import { isAuthenticated, isAdmin } from "../middleware/auth.middleware.js";
import { isApprovedMerchant } from "../middleware/merchant.middleware.js";

import {
  validateOrderStatusUpdate,
  validateOrderCreate,
  // ✅ optional new validator
  validatePaymentStatusUpdate,
  validateBankakReject,
} from "../middleware/validators/order.validator.js";

import { validateObjectId } from "../middleware/validation.middleware.js";
import { validateStatusFilter } from "../middleware/validators/query.validator.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Admin routes
// ─────────────────────────────────────────────────────────────

// ✅ List orders (admin)
router.get("/admin", isAuthenticated, isAdmin, getOrders);

// ✅ (optional) Stats endpoint — should call dedicated controller (recommended)
// router.get("/admin/stats", isAuthenticated, isAdmin, getAdminOrderStats);

// ✅ Order details (admin uses same)
router.get("/:id", isAuthenticated, ...validateObjectId("id"), getOrderById);

// ✅ Update delivery/workflow status (admin)
router.patch(
  "/:id/status",
  isAuthenticated,
  isAdmin,
  ...validateObjectId("id"),
  validateOrderStatusUpdate,
  updateOrderStatus
);

// ✅ NEW: Bankak approvals (admin)
router.patch(
  "/:id/payment/approve",
  isAuthenticated,
  isAdmin,
  ...validateObjectId("id"),
  approveBankakPayment
);

router.patch(
  "/:id/payment/reject",
  isAuthenticated,
  isAdmin,
  ...validateObjectId("id"),
  validateBankakReject,
  rejectBankakPayment
);

// ✅ Optional: manual payment status update (admin)
// ⚠️ Not recommended for BANKAK (use approve/reject)
router.patch(
  "/:id/payment/status",
  isAuthenticated,
  isAdmin,
  ...validateObjectId("id"),
  validatePaymentStatusUpdate,
  updatePaymentStatus
);

// ─────────────────────────────────────────────────────────────
// Merchant routes
// ─────────────────────────────────────────────────────────────
router.get(
  "/merchant/my-orders",
  isAuthenticated,
  isApprovedMerchant,
  validateStatusFilter(["pending", "confirmed", "shipped", "delivered", "cancelled"]),
  getMerchantOrders
);

router.get("/merchant/stats", isAuthenticated, isApprovedMerchant, getMerchantOrderStats);

// ─────────────────────────────────────────────────────────────
// User routes
// ─────────────────────────────────────────────────────────────
router.get("/my-orders", isAuthenticated, getUserOrders);
router.post("/", isAuthenticated, validateOrderCreate, createOrder);

export default router;
