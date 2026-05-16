import express from "express";
import { body, param, query } from "express-validator";
import {
  createTicket,
  getTickets,
  getTicketDetails,
  updateStatus,
  addMessage,
  getStats,
} from "../controllers/tickets.controller.js";
import { handleValidationErrors } from "../middleware/validation.middleware.js";
import { isAuthenticated, isAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

// POST /tickets
router.post(
  "/",
  isAuthenticated,
  [
    body("type")
      .isIn(["support", "complaint", "legal"])
      .withMessage("Invalid ticket type"),
    body("category")
      .isIn([
        "order_issue",
        "payment_issue",
        "merchant_complaint",
        "product_report",
        "fraud",
        "health_risk",
        "other",
      ])
      .withMessage("Invalid category"),
    body("subject")
      .trim()
      .notEmpty()
      .withMessage("Subject is required")
      .isLength({ max: 200 })
      .withMessage("Subject too long"),
    body("description").notEmpty().withMessage("Description is required"),
    body("relatedOrderId").optional().isMongoId().withMessage("Invalid Order ID"),
    body("relatedProductId").optional().isMongoId().withMessage("Invalid Product ID"),
    body("relatedMerchantId").optional().isMongoId().withMessage("Invalid Merchant ID"),
    body("priority").optional().isIn(["low", "medium", "high"]),
    body("attachments").optional().isArray(),
    handleValidationErrors,
  ],
  createTicket
);

// GET /tickets/stats
router.get("/stats", isAuthenticated, isAdmin, getStats);

// GET /tickets
router.get(
  "/",
  isAuthenticated,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn([
        "open",
        "under_review",
        "waiting_customer",
        "escalated",
        "resolved_refund",
        "resolved_rejected",
        "closed",
    ]),
    query("priority").optional().isIn(["low", "medium", "high"]),
    handleValidationErrors,
  ],
  getTickets
);

// GET /tickets/:id
router.get(
  "/:id",
  isAuthenticated,
  [
    param("id").isMongoId().withMessage("Invalid Ticket ID"),
    handleValidationErrors
  ],
  getTicketDetails
);

// PATCH /tickets/:id/status
router.patch(
  "/:id/status",
  isAuthenticated,
  isAdmin,
  [
    param("id").isMongoId(),
    body("status")
      .isIn([
        "open",
        "under_review",
        "waiting_customer",
        "escalated",
        "resolved_refund",
        "resolved_rejected",
        "closed",
      ])
      .withMessage("Invalid status"),
    body("adminNotes").optional().isString(),
    handleValidationErrors,
  ],
  updateStatus
);

// POST /tickets/:id/messages
router.post(
  "/:id/messages",
  isAuthenticated,
  [
    param("id").isMongoId(),
    body("message").notEmpty().withMessage("Message is required"),
    body("attachments").optional().isArray(),
    handleValidationErrors,
  ],
  addMessage
);

export default router;
