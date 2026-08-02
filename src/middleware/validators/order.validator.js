import { body } from "express-validator";
import { handleValidationErrors } from "../validation.middleware.js";

/**
 * The admin dashboard speaks a wider, uppercase payment vocabulary than the
 * Order model stores. `status` has been mapped that way since the start (see
 * below); `paymentStatus` was not, so the dashboard's "PAID" 400'd on
 * PATCH /orders/:id/payment/status. Collapsing is lossy on purpose — BANKAK
 * confirmation/rejection has its own approve/reject endpoints that record the
 * detail; this manual path only needs the model's three states.
 */
const PAYMENT_STATUS_MAP = {
  UNPAID: "pending",
  PENDING_CONFIRMATION: "pending",
  PAID: "paid",
  REJECTED: "failed",
  FAILED: "failed",
  pending: "pending",
  paid: "paid",
  failed: "failed",
};

const normalizePaymentStatus = (value) =>
  PAYMENT_STATUS_MAP[value] ?? PAYMENT_STATUS_MAP[String(value).toUpperCase()];

const assertPaymentStatus = (value) => {
  if (!normalizePaymentStatus(value)) {
    throw new Error(
      `paymentStatus must be one of: ${Object.keys(PAYMENT_STATUS_MAP).join(", ")}`
    );
  }
  return true;
};

export const validateOrderStatusUpdate = [
  body("status")
    .optional()
    .custom((value) => {
      if (!value) return true;
      const allowed = [
        "PENDING", "AWAITING_PAYMENT_CONFIRMATION",
        "CONFIRMED", "PROCESSING",
        "SHIPPED", "DELIVERED", "CANCELLED", "PAYMENT_FAILED",
      ];
      if (!allowed.includes(value)) {
        throw new Error(`Status must be one of: ${allowed.join(", ")}`);
      }
      return true;
    })
    .customSanitizer((value) => {
      if (!value) return value;
      const map = {
        PENDING: "pending",
        AWAITING_PAYMENT_CONFIRMATION: "pending",
        CONFIRMED: "confirmed",
        PROCESSING: "confirmed",
        SHIPPED: "shipped",
        DELIVERED: "delivered",
        CANCELLED: "cancelled",
        PAYMENT_FAILED: "cancelled",
      };
      return map[value] || value.toLowerCase();
    }),
  body("paymentStatus")
    .optional()
    .custom((value) => (value ? assertPaymentStatus(value) : true))
    .customSanitizer((value) => (value ? normalizePaymentStatus(value) : value)),
  handleValidationErrors,
];

export const validatePaymentStatusUpdate = [
  body("paymentStatus")
    .notEmpty()
    .withMessage("paymentStatus is required")
    .bail()
    .custom(assertPaymentStatus)
    .customSanitizer(normalizePaymentStatus),
  handleValidationErrors,
];

export const validateBankakReject = [
  body("reason")
    .optional()
    .isString()
    .withMessage("reason must be a string")
    .isLength({ max: 500 })
    .withMessage("reason must be under 500 characters"),
  handleValidationErrors,
];

export const validateOrderCreate = [
  // addressId is required — the service resolves address text from it
  body("addressId")
    .exists({ checkFalsy: true }).withMessage("addressId is required")
    .bail()
    .isMongoId().withMessage("addressId must be a valid MongoId"),

  body("paymentMethod")
    .exists({ checkFalsy: true }).withMessage("paymentMethod is required")
    .bail()
    .custom((v) => ["CASH", "BANKAK", "CARD"].includes(String(v).trim().toUpperCase()))
    .withMessage("paymentMethod must be one of: CASH, BANKAK, CARD"),

  body("transferProof")
    .optional({ nullable: true })
    .isString().withMessage("transferProof must be a string")
    .bail()
    .isLength({ min: 5, max: 2000 }).withMessage("transferProof must be between 5 and 2000 characters"),

  body("couponCode")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 50 }).withMessage("couponCode must be under 50 characters"),

  body("referralCode")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 20 }).withMessage("referralCode must be under 20 characters"),

  handleValidationErrors,
];
