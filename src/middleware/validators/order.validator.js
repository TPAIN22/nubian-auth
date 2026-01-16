import { body } from "express-validator";
import Address from "../../models/address.model.js";
import { handleValidationErrors } from "../validation.middleware.js";

const buildAddressString = (a) => {
  if (!a) return "";
  return [a.city, a.area, a.street, a.building].filter(Boolean).join(" - ");
};

export const validateOrderStatusUpdate = [
  body("status")
    .optional()
    .custom((value) => {
      if (!value) return true; // allow empty/undefined for optional field
      const allowedStatuses = ["PENDING", "AWAITING_PAYMENT_CONFIRMATION", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "PAYMENT_FAILED"];
      if (!allowedStatuses.includes(value)) {
        throw new Error(`Status must be one of: ${allowedStatuses.join(", ")}`);
      }
      return true;
    })
    .customSanitizer((value) => {
      // Convert frontend uppercase statuses to backend lowercase statuses
      if (!value) return value;
      const statusMap = {
        "PENDING": "pending",
        "AWAITING_PAYMENT_CONFIRMATION": "pending", // map to pending for now
        "CONFIRMED": "confirmed",
        "PROCESSING": "confirmed", // map processing to confirmed
        "SHIPPED": "shipped",
        "DELIVERED": "delivered",
        "CANCELLED": "cancelled",
        "PAYMENT_FAILED": "cancelled" // map payment failed to cancelled
      };
      return statusMap[value] || value.toLowerCase();
    }),
  body("paymentStatus")
    .optional()
    .isIn(["pending", "paid", "failed"])
    .withMessage("Payment status must be one of: pending, paid, failed"),
  handleValidationErrors,
];

export const validatePaymentStatusUpdate = (req, res, next) => {
  const { paymentStatus } = req.body || {};
  const allowed = ["PENDING", "PAID", "FAILED"];
  if (!allowed.includes(paymentStatus)) {
    return res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid paymentStatus" },
    });
  }
  next();
};

export const validateBankakReject = (req, res, next) => {
  const { reason } = req.body || {};
  if (reason && typeof reason !== "string") {
    return res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid reason" },
    });
  }
  next();
};


export const validateOrderCreate = [
  // ✅ Normalize: derive shippingAddress/phoneNumber from addressId if missing
  async (req, res, next) => {
    try {
      const { addressId } = req.body || {};

      // aliases
      if (!req.body.transferProof && req.body.paymentProofUrl) {
        req.body.transferProof = req.body.paymentProofUrl;
      }

      // if missing fields, load address from DB
      const needShip = !req.body.shippingAddress;
      const needPhone = !req.body.phoneNumber;

      if ((needShip || needPhone) && addressId) {
        const addr = await Address.findById(addressId).lean();
        if (addr) {
          if (needShip) req.body.shippingAddress = buildAddressString(addr);
          if (needPhone) req.body.phoneNumber = addr.phone || addr.whatsapp || "";
        }
      }

      // ✅ also create deliveryAddress for compatibility with controller
      if (!req.body.deliveryAddress) req.body.deliveryAddress = {};
      if (req.body.shippingAddress && !req.body.deliveryAddress.address) {
        req.body.deliveryAddress.address = req.body.shippingAddress;
      }
      if (req.body.phoneNumber && !req.body.deliveryAddress.phone) {
        req.body.deliveryAddress.phone = req.body.phoneNumber;
      }

      next();
    } catch (e) {
      next(e);
    }
  },

  body("addressId")
    .exists({ checkFalsy: true })
    .withMessage("addressId is required")
    .bail()
    .isMongoId()
    .withMessage("addressId must be a valid MongoId"),

  body("shippingAddress")
    .exists({ checkFalsy: true })
    .withMessage("shippingAddress is required")
    .bail()
    .isString()
    .withMessage("shippingAddress must be a string")
    .bail()
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage("shippingAddress must be between 10 and 500 characters"),

  body("phoneNumber")
    .exists({ checkFalsy: true })
    .withMessage("phoneNumber is required")
    .bail()
    .isString()
    .withMessage("phoneNumber must be a string")
    .bail()
    .trim()
    .isLength({ min: 5, max: 20 })
    .withMessage("phoneNumber must be between 5 and 20 characters"),

  body("paymentMethod")
    .exists({ checkFalsy: true })
    .withMessage("paymentMethod is required")
    .bail()
    .custom((v) => {
      const val = String(v).trim().toUpperCase();
      return ["CASH", "BANKAK", "CARD"].includes(val);
    })
    .withMessage("paymentMethod must be one of: CASH, BANKAK, CARD"),

  body("transferProof")
    .optional({ nullable: true })
    .isString()
    .withMessage("transferProof must be a string")
    .bail()
    .isLength({ min: 5, max: 2000 })
    .withMessage("transferProof must be between 5 and 2000 characters"),

  body("items").isArray({ min: 1 }).withMessage("items must be a non-empty array"),

  body("items.*.productId")
    .exists({ checkFalsy: true })
    .withMessage("items.productId is required")
    .bail()
    .isMongoId()
    .withMessage("items.productId must be a valid MongoId"),

  body("items.*.quantity")
    .exists({ checkFalsy: true })
    .withMessage("items.quantity is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("items.quantity must be >= 1"),

  handleValidationErrors,
];
