import express from "express";
import { body, param, query, validationResult } from "express-validator";
import {
  createTicket,
  getTickets,
  getTicketDetails,
  updateStatus,
  addMessage,
  getStats,
} from "../controllers/tickets.controller.js";
import { validate } from "../middleware/validate.middleware.js";

const router = express.Router();

// Validation Middleware Wrapper (if needed, but importing generic 'validate' is better if standard)
// Since we import 'validate' from middleware, we should use it.
// BUT current code uses 'handleValidationErrors' inline. I will use the imported validate.

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

// POST /tickets
router.post(
  "/",
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
    handleValidationErrors,
  ],
  createTicket
);

// GET /tickets/stats
router.get("/stats", getStats);

// GET /tickets
router.get(
  "/",
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
  [
    param("id").isMongoId().withMessage("Invalid Ticket ID"),
    handleValidationErrors
  ],
  getTicketDetails // Ensure controller exports this name. (It was getTicketDetails in my view)
);

// PATCH /tickets/:id/status
router.patch(
  "/:id/status",
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
  updateStatus // Ensure controller exports this name. (It was updateStatus in my view)
);

// POST /tickets/:id/messages
router.post(
  "/:id/messages",
  [
    param("id").isMongoId(),
    body("message").notEmpty().withMessage("Message is required"),
    body("attachments").optional().isArray(),
    handleValidationErrors,
  ],
  addMessage
);

export default router;
