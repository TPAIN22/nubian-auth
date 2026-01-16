import Order from "../models/orders.model.js";
import Cart from "../models/carts.model.js";
import Address from "../models/address.model.js";
import Merchant from "../models/merchant.model.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";
import { sendOrderEmail } from "../lib/mail.js";
import Coupon from "../models/coupon.model.js";
import Marketer from "../models/marketer.model.js";
import logger from "../lib/logger.js";
import { sendSuccess, sendError, sendNotFound, sendForbidden } from "../lib/response.js";
import { getProductPrice, mapToObject } from "../utils/cartUtils.js";
import { handleOrderCreated, handleOrderStatusChanged } from "../services/notificationEventHandlers.js";

/**
 * Build a readable shipping address string snapshot.
 * Stored in Order.address (string).
 */
function buildShippingAddressText(addr) {
  const parts = [
    addr?.name,
    addr?.city,
    addr?.area,
    addr?.street,
    addr?.building,
    addr?.notes ? `ملاحظات: ${addr.notes}` : null,
  ].filter(Boolean);

  return parts.join(" - ").trim();
}

/**
 * Normalize payment method coming from mobile/dashboard.
 * Accepts: BANKAK | CASH | CARD and legacy cash/card.
 */
function normalizePaymentMethod(value) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "BANKAK") return "BANKAK";
  if (v === "CASH") return "CASH";
  if (v === "CARD") return "CARD";

  // legacy
  if (v === "CASH_ON_DELIVERY") return "CASH";
  if (v === "CREDIT_CARD") return "CARD";

  return v || null;
}

export const updateOrderStatus = async (req, res) => {
  try {
    const { status, paymentStatus } = req.body;
    const { id } = req.params;

    const allowedStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

    const updateData = {};

    if (status !== undefined) {
      // Convert frontend statuses to backend compatible ones if needed
      let normalizedStatus = status;
      if (status === "PROCESSING") normalizedStatus = "confirmed";
      if (status === "AWAITING_PAYMENT_CONFIRMATION") normalizedStatus = "pending";
      if (status === "PAYMENT_FAILED") normalizedStatus = "cancelled";

      if (!allowedStatuses.includes(normalizedStatus)) {
        return sendError(res, {
          message: "Invalid status value",
          code: "INVALID_STATUS",
          statusCode: 400,
          details: { allowedStatuses },
        });
      }
      updateData.status = normalizedStatus;
    }

    if (paymentStatus !== undefined) {
      if (!allowedPaymentStatus.includes(paymentStatus)) {
        return sendError(res, {
          message: "Invalid payment status value",
          code: "INVALID_PAYMENT_STATUS",
          statusCode: 400,
          details: { allowedPaymentStatus },
        });
      }
      updateData.paymentStatus = paymentStatus;
    }

    if (Object.keys(updateData).length === 0) {
      return sendError(res, {
        message: "No valid data to update",
        code: "NO_UPDATE_DATA",
        statusCode: 400,
      });
    }

    const oldOrder = await Order.findById(id)
      .populate("products.product", "name price images category description stock")
      .populate("user", "fullName emailAddress phoneNumber")
      .populate("merchants");

    if (!oldOrder) return sendNotFound(res, "Order");

    const oldStatus = oldOrder.status;

    const order = await Order.findByIdAndUpdate(id, updateData, { new: true })
      .populate("products.product", "name price images category description stock")
      .populate("user", "fullName emailAddress phoneNumber")
      .populate("merchants");

    // marketer commission only on first delivered
    if (
      status === "delivered" &&
      oldStatus !== "delivered" &&
      order.marketer &&
      (!order.marketerCommission || order.marketerCommission === 0)
    ) {
      const marketer = await Marketer.findById(order.marketer);
      if (marketer) {
        const commission = order.finalAmount * marketer.commissionRate;
        order.marketerCommission = commission;
        await order.save();

        marketer.totalEarnings += commission;
        await marketer.save();
      }
    }

    if (status && status !== oldStatus) {
      handleOrderStatusChanged(order._id, oldStatus, status).catch((error) => {
        logger.error("Failed to send order status change notification", {
          error: error.message,
          orderId: order._id.toString(),
          oldStatus,
          newStatus: status,
        });
      });
    }

    return sendSuccess(res, { data: order, message: "Order status updated successfully" });
  } catch (error) {
    throw error;
  }
};

export const getUserOrders = async (req, res) => {
  const { userId } = getAuth(req);

  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) return sendNotFound(res, "User");

    const orders = await Order.find({ user: user._id })
      .populate({
        path: "products.product",
        select: "name price discountPrice images category description stock createdAt",
      })
      .populate("user", "fullName emailAddress phoneNumber")
      .populate("coupon", "code type value")
      .sort({ orderDate: -1 });

    const enhancedOrders = orders.map((order) => ({
      ...order.toObject(),
      transferProof: order.transferProof || null,
      productsCount: order.products.length,
      productsDetails: order.products.map((item) => {
        const finalPrice =
          item.price ||
          item.product?.finalPrice ||
          item.product?.discountPrice ||
          item.product?.price ||
          0;

        const merchantPrice =
          item.merchantPrice ||
          item.product?.merchantPrice ||
          item.product?.price ||
          0;

        return {
          productId: item.product?._id || null,
          name: item.product?.name || "",
          price: finalPrice,
          merchantPrice,
          discountPrice: item.discountPrice || item.product?.discountPrice,
          originalPrice: merchantPrice,
          nubianMarkup: item.nubianMarkup || item.product?.nubianMarkup || 10,
          dynamicMarkup: item.dynamicMarkup || item.product?.dynamicMarkup || 0,
          images: item.product?.images || [],
          category: item.product?.category || "",
          description: item.product?.description || "",
          stock: item.product?.stock || 0,
          quantity: item.quantity,
          totalPrice: finalPrice * item.quantity,
        };
      }),
    }));

    return res.status(200).json(enhancedOrders);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const createOrder = async (req, res) => {
  const { userId } = getAuth(req);

  // order number (computed early)
  let lastOrder = await Order.findOne().sort({ createdAt: -1 });
  if (!lastOrder) lastOrder = { orderNumber: "ORD-0001" };

  let nextOrderNumber = 1;
  if (lastOrder?.orderNumber) {
    const lastNumber = parseInt(String(lastOrder.orderNumber).split("-")[1] || "0", 10);
    nextOrderNumber = lastNumber + 1;
  }
  const formattedOrderNumber = `ORD-${String(nextOrderNumber).padStart(4, "0")}`;

  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) return sendNotFound(res, "User");

    const cart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      populate: { path: "merchant" },
    });

    if (!cart || cart.products.length === 0) {
      return sendError(res, { message: "Cart is empty or not found" }, 400);
    }

    // ---------- Resolve shipping snapshot ----------
    const addressId = req.body.addressId ? String(req.body.addressId) : null;

    let addressText = "";
    let phoneNumber = "";
    let city = "";

    if (addressId) {
      const addr = await Address.findById(addressId);
      if (!addr) {
        return sendError(
          res,
          {
            message: "Address not found",
            code: "ADDRESS_NOT_FOUND",
            statusCode: 400,
            details: [{ field: "addressId", message: "Invalid addressId", value: addressId }],
          },
          400
        );
      }

      // ownership check
      if (String(addr.user) !== String(user._id)) {
        return sendForbidden(res, "You do not own this address");
      }

      addressText = buildShippingAddressText(addr);
      phoneNumber = String(addr.phone || addr.whatsapp || "").trim();
      city = String(addr.city || "").trim();
    } else {
      // legacy fallback (if someone still sends shippingAddress/phoneNumber)
      addressText = String(req.body.shippingAddress || "").trim();
      phoneNumber = String(req.body.phoneNumber || "").trim();
      city = String(req.body.city || "").trim();
    }

    // final guard (same as validator rules)
    if (!addressText || addressText.length < 10 || addressText.length > 500) {
      return sendError(
        res,
        {
          message: "Validation error",
          code: "VALIDATION_ERROR",
          statusCode: 400,
          details: [
            {
              field: "shippingAddress",
              message: "shippingAddress must be between 10 and 500 characters",
              value: addressText || "",
            },
          ],
        },
        400
      );
    }

    if (!phoneNumber || phoneNumber.length < 5 || phoneNumber.length > 20) {
      return sendError(
        res,
        {
          message: "Validation error",
          code: "VALIDATION_ERROR",
          statusCode: 400,
          details: [
            {
              field: "phoneNumber",
              message: "phoneNumber must be between 5 and 20 characters",
              value: phoneNumber || "",
            },
          ],
        },
        400
      );
    }

    if (!city) city = "غير محدد";

    // ---------- Build products & pricing snapshot ----------
    const orderProducts = [];
    let totalAmount = 0;

    const merchantMap = new Map(); // merchantId -> { amount, products }
    const merchantIds = new Set();
    const unmerchantedProducts = [];
    let merchantTotalAmount = 0;
    let platformTotalAmount = 0;

    for (const item of cart.products) {
      let itemAttributes = {};
      if (item.attributes && item.attributes instanceof Map) {
        itemAttributes = mapToObject(item.attributes);
      } else if (item.size) {
        itemAttributes = { size: item.size };
      }

      const itemPrice = getProductPrice(item.product, itemAttributes);

      const itemVariant = item.variantId ? item.product.variants?.id(item.variantId) : null;

      const itemMerchantPrice = itemVariant
        ? itemVariant.merchantPrice || itemVariant.price || 0
        : item.product.merchantPrice || item.product.price || 0;

      const itemNubianMarkup = itemVariant
        ? itemVariant.nubianMarkup || 10
        : item.product.nubianMarkup || 10;

      const itemDynamicMarkup = itemVariant
        ? itemVariant.dynamicMarkup || 0
        : item.product.dynamicMarkup || 0;

      const itemTotal = itemPrice * item.quantity;
      totalAmount += itemTotal;

      orderProducts.push({
        product: item.product._id,
        variantId: itemVariant?._id || item.variantId || null,
        quantity: item.quantity,
        price: itemPrice,
        merchantPrice: itemMerchantPrice,
        nubianMarkup: itemNubianMarkup,
        dynamicMarkup: itemDynamicMarkup,
        discountPrice: itemVariant ? itemVariant.discountPrice : item.product.discountPrice,
        originalPrice: itemMerchantPrice,
      });

      const productMerchant = item.product.merchant;

      if (productMerchant) {
        const merchantId = productMerchant._id
          ? productMerchant._id.toString()
          : productMerchant.toString();

        merchantIds.add(merchantId);
        merchantTotalAmount += itemTotal;

        if (!merchantMap.has(merchantId)) merchantMap.set(merchantId, { amount: 0, products: [] });

        const merchantData = merchantMap.get(merchantId);
        merchantData.amount += itemTotal;
        merchantData.products.push({
          product: item.product._id,
          quantity: item.quantity,
          price: itemPrice,
          merchantPrice: itemMerchantPrice,
          nubianMarkup: itemNubianMarkup,
          dynamicMarkup: itemDynamicMarkup,
        });
      } else {
        platformTotalAmount += itemTotal;
        unmerchantedProducts.push({
          product: item.product._id,
          name: item.product.name,
          quantity: item.quantity,
          price: itemPrice,
          merchantPrice: itemMerchantPrice,
          total: itemTotal,
        });
      }
    }

    // trust cart.totalPrice if it matches
    if (cart.totalPrice && Math.abs(cart.totalPrice - totalAmount) < 0.01) {
      totalAmount = cart.totalPrice;
    }

    if (unmerchantedProducts.length > 0) {
      logger.warn("Order contains products without merchants", {
        requestId: req.requestId,
        orderNumber: formattedOrderNumber,
        unmerchantedCount: unmerchantedProducts.length,
        platformTotalAmount,
        products: unmerchantedProducts.map((p) => ({
          productId: p.product.toString(),
          name: p.name,
          quantity: p.quantity,
        })),
      });
    }

    // ---------- Discounts (coupon / marketer) ----------
    let discountAmount = 0;
    let couponId = null;
    let couponDetails = null;

    if (req.body.couponCode) {
      const couponCode = String(req.body.couponCode).toUpperCase().trim();
      const coupon = await Coupon.findOne({ code: couponCode, isActive: true });

      if (!coupon) return sendError(res, { message: "Invalid or inactive coupon code" }, 400);

      const now = new Date();
      const startDate = coupon.startDate || new Date(0);
      const endDate = coupon.endDate || coupon.expiresAt;

      if (startDate > now) return sendError(res, { message: "Coupon is not yet active" }, 400);
      if (endDate < now) return sendError(res, { message: "Coupon has expired" }, 400);

      const usageLimit = coupon.usageLimitGlobal || coupon.usageLimit;
      if (usageLimit !== null && usageLimit > 0 && coupon.usageCount >= usageLimit) {
        return sendError(res, { message: "Coupon usage limit reached" }, 400);
      }

      const userUsedCount = coupon.usedBy.filter((u) => u.toString() === user._id.toString()).length;
      if (coupon.usageLimitPerUser > 0 && userUsedCount >= coupon.usageLimitPerUser) {
        return sendError(
          res,
          { message: "You have already used this coupon the maximum allowed times" },
          400
        );
      }

      if (coupon.minOrderAmount > 0 && totalAmount < coupon.minOrderAmount) {
        return sendError(res, { message: `Minimum order amount of ${coupon.minOrderAmount} required` }, 400);
      }

      discountAmount = coupon.calculateDiscount(totalAmount);

      couponId = coupon._id;
      couponDetails = {
        code: coupon.code,
        type: coupon.type || coupon.discountType,
        value: coupon.value || coupon.discountValue,
        discountAmount,
      };

      coupon.usedBy.push(user._id);
      coupon.usageCount = (coupon.usageCount || 0) + 1;
      coupon.totalDiscountGiven = (coupon.totalDiscountGiven || 0) + discountAmount;
      coupon.totalOrders = (coupon.totalOrders || 0) + 1;
      await coupon.save();
    }

    if (req.body.marketerCode) {
      const marketer = await Marketer.findOne({ code: String(req.body.marketerCode).toUpperCase() });
      if (marketer) {
        const marketerDiscount = totalAmount * marketer.discountRate;
        discountAmount += marketerDiscount;
        if (discountAmount > totalAmount) discountAmount = totalAmount;
      }
    }

    let finalAmount = totalAmount - discountAmount;
    if (finalAmount < 0) finalAmount = 0;

    const merchantRevenue = Array.from(merchantMap.entries()).map(([merchantId, data]) => {
      const merchantDiscount =
        merchantTotalAmount > 0 ? (data.amount / merchantTotalAmount) * discountAmount : 0;

      const merchantFinalAmount = data.amount - merchantDiscount;

      return { merchant: merchantId, amount: Math.max(0, merchantFinalAmount) };
    });

    if (merchantTotalAmount + platformTotalAmount !== totalAmount) {
      logger.error("Order amount mismatch detected", {
        requestId: req.requestId,
        orderNumber: formattedOrderNumber,
        totalAmount,
        merchantTotalAmount,
        platformTotalAmount,
        sum: merchantTotalAmount + platformTotalAmount,
        difference: totalAmount - (merchantTotalAmount + platformTotalAmount),
      });
    }

    // ---------- Payment ----------
    const paymentMethod = normalizePaymentMethod(req.body.paymentMethod);

    if (!paymentMethod || !["CASH", "BANKAK", "CARD"].includes(paymentMethod)) {
      return sendError(
        res,
        {
          message: "Invalid payment method",
          code: "INVALID_PAYMENT_METHOD",
          statusCode: 400,
          details: [
            { field: "paymentMethod", message: "Use CASH, BANKAK or CARD", value: req.body.paymentMethod },
          ],
        },
        400
      );
    }

    const transferProof = req.body.transferProof || req.body.paymentProofUrl || null;

    if (paymentMethod === "BANKAK") {
      if (!transferProof || !String(transferProof).startsWith("http")) {
        return sendError(
          res,
          {
            message: "Validation error",
            code: "VALIDATION_ERROR",
            statusCode: 400,
            details: [
              {
                field: "transferProof",
                message: "transferProof is required for BANKAK and must be a valid URL",
                value: transferProof || "",
              },
            ],
          },
          400
        );
      }
    }

    // ---------- Create Order (Schema-compatible) ----------
    const order = await Order.create({
      user: user._id,
      products: orderProducts,

      totalAmount,
      discountAmount,
      finalAmount,

      coupon: couponId,
      couponDetails: couponDetails || null,

      paymentMethod,
      paymentStatus: "pending",
      orderNumber: formattedOrderNumber,

      // ✅ schema fields
      address: addressText,
      phoneNumber,
      city,

      transferProof,

      marketer: req.body.marketerCode
        ? (await Marketer.findOne({ code: String(req.body.marketerCode).toUpperCase() }))?._id
        : null,
      marketerCommission: 0,

      merchants: Array.from(merchantIds),
      merchantRevenue,
    });

    await Cart.findOneAndDelete({ user: user._id });

    // Email
    try {
      await sendOrderEmail({
        to: user.emailAddress || user.email,
        userName: user.fullName || user.name || "",
        orderNumber: formattedOrderNumber,
        status: "بانتظار التأكيد",
        totalAmount: finalAmount,
        products: cart.products.map((item) => {
          let itemAttributes = {};
          if (item.attributes && item.attributes instanceof Map) itemAttributes = mapToObject(item.attributes);
          else if (item.size) itemAttributes = { size: item.size };

          const itemPrice = getProductPrice(item.product, itemAttributes);
          return { name: item.product.name, quantity: item.quantity, price: itemPrice };
        }),
      });
    } catch (mailErr) {
      logger.error("Failed to send order email", {
        requestId: req.requestId,
        error: mailErr.message,
        stack: mailErr.stack,
        orderNumber: formattedOrderNumber,
      });
    }

    handleOrderCreated(order._id).catch((error) => {
      logger.error("Failed to send order created notification", {
        error: error.message,
        orderId: order._id.toString(),
      });
    });

    return res.status(201).json(order);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getOrders = async (req, res) => {
  try {
    const { status } = req.query;

    let filter = {};
    if (status && status !== 'all') {
      // Normalize status for database query
      let normalizedStatus = status;
      if (status === "PENDING") normalizedStatus = "pending";
      if (status === "AWAITING_PAYMENT_CONFIRMATION") normalizedStatus = "pending";
      if (status === "CONFIRMED") normalizedStatus = "confirmed";
      if (status === "PROCESSING") normalizedStatus = "confirmed";
      if (status === "SHIPPED") normalizedStatus = "shipped";
      if (status === "DELIVERED") normalizedStatus = "delivered";
      if (status === "CANCELLED") normalizedStatus = "cancelled";
      if (status === "PAYMENT_FAILED") normalizedStatus = "cancelled";

      filter.status = normalizedStatus;
    }

    const orders = await Order.find(filter)
      .populate({ path: "user", select: "fullName emailAddress phoneNumber" })
      .populate({
        path: "products.product",
        select: "name price discountPrice images category description stock createdAt",
      })
      .populate("merchants", "businessName")
      .populate("coupon", "code type value")
      .sort({ orderDate: -1 });

    const enhancedOrders = orders.map((order) => ({
      ...order.toObject(),
      transferProof: order.transferProof || null,
      productsCount: order.products.length,
      customerInfo: {
        name: order.user?.fullName || "غير محدد",
        email: order.user?.emailAddress || "غير محدد",
        phone: order.phoneNumber,
      },
      productsDetails: order.products.map((item) => {
        const finalPrice =
          item.price ||
          item.product?.finalPrice ||
          item.product?.discountPrice ||
          item.product?.price ||
          0;

        const merchantPrice =
          item.merchantPrice || item.product?.merchantPrice || item.product?.price || 0;

        const nubianMarkup = item.nubianMarkup || item.product?.nubianMarkup || 10;
        const dynamicMarkup = item.dynamicMarkup || item.product?.dynamicMarkup || 0;

        return {
          productId: item.product?._id || null,
          name: item.product?.name || "",
          price: finalPrice,
          merchantPrice,
          originalPrice: merchantPrice,
          discountPrice: item.discountPrice || item.product?.discountPrice || undefined,
          nubianMarkup,
          dynamicMarkup,
          pricingBreakdown: {
            merchantPrice,
            nubianMarkup,
            dynamicMarkup,
            finalPrice,
          },
          images: item.product?.images || [],
          category: item.product?.category || "",
          description: item.product?.description || "",
          stock: item.product?.stock || 0,
          quantity: item.quantity,
          totalPrice: finalPrice * item.quantity,
        };
      }),
      orderSummary: {
        subtotal: order.totalAmount,
        discount: order.discountAmount,
        total: order.finalAmount,
      },
    }));

    return res.status(200).json(enhancedOrders);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getOrderById = async (req, res) => {
  const { userId } = getAuth(req);

  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) return sendNotFound(res, "User");

    const order = await Order.findById(req.params.id)
      .populate("user", "fullName emailAddress phoneNumber")
      .populate({
        path: "products.product",
        select: "name price discountPrice images category description stock createdAt updatedAt",
      })
      .populate("coupon", "code type value");

    if (!order) return sendNotFound(res, "Order");

    if (String(order.user?._id) !== String(user._id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const enhancedOrder = {
      ...order.toObject(),
      transferProof: order.transferProof || null,
      productsCount: order.products.length,
      productsDetails: order.products.map((item) => {
        const finalPrice =
          item.price ||
          item.product?.finalPrice ||
          item.product?.discountPrice ||
          item.product?.price ||
          0;

        const merchantPrice =
          item.merchantPrice || item.product?.merchantPrice || item.product?.price || 0;

        const nubianMarkup = item.nubianMarkup || item.product?.nubianMarkup || 10;
        const dynamicMarkup = item.dynamicMarkup || item.product?.dynamicMarkup || 0;

        return {
          productId: item.product?._id || null,
          name: item.product?.name || "",
          price: finalPrice,
          merchantPrice,
          originalPrice: merchantPrice,
          discountPrice: item.discountPrice || item.product?.discountPrice || undefined,
          nubianMarkup,
          dynamicMarkup,
          pricingBreakdown: {
            merchantPrice,
            nubianMarkup,
            dynamicMarkup,
            finalPrice,
          },
          images: item.product?.images || [],
          category: item.product?.category || "",
          description: item.product?.description || "",
          stock: item.product?.stock || 0,
          quantity: item.quantity,
          totalPrice: finalPrice * item.quantity,
          isAvailable: (item.product?.stock || 0) > 0,
        };
      }),
      orderSummary: {
        subtotal: order.totalAmount,
        discount: order.discountAmount,
        total: order.finalAmount,
      },
    };

    return res.status(200).json(enhancedOrder);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getOrderStats = async (req, res) => {
  try {
    const stats = await Order.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$totalAmount" } } },
    ]);

    const totalOrders = await Order.countDocuments();
    const totalRevenue = await Order.aggregate([
      { $match: { status: { $ne: "cancelled" } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);

    return res.status(200).json({
      statusStats: stats,
      totalOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Get merchant's orders
export const getMerchantOrders = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const merchant = await Merchant.findOne({ clerkId: userId, status: "APPROVED" });
    if (!merchant) return res.status(403).json({ message: "Merchant not found or not approved" });

    const { status } = req.query;

    const filter = { merchants: merchant._id };
    if (status) filter.status = status;

    const orders = await Order.find(filter)
      .populate({ path: "user", select: "fullName emailAddress phoneNumber" })
      .populate({
        path: "products.product",
        select: "name price images category description stock merchant",
        populate: { path: "merchant", select: "businessName" },
      })
      .sort({ orderDate: -1 });

    const enhancedOrders = orders.map((order) => {
      // For merchants, show all products in their orders (they can see what customers ordered)
      const orderProducts = order.products || [];

      const merchantRevenueEntry = order.merchantRevenue?.find(
        (mr) => String(mr.merchant) === String(merchant._id)
      );

      const merchantOrderTotal = orderProducts.reduce((sum, item) => {
        const p = item.price || item.product?.price || 0;
        return sum + p * item.quantity;
      }, 0);

      return {
        ...order.toObject(),
        transferProof: order.transferProof || null,
        products: orderProducts,
        productsCount: orderProducts.length,
        merchantRevenue: merchantRevenueEntry?.amount || merchantOrderTotal,
        customerInfo: {
          name: order.user?.fullName || "غير محدد",
          email: order.user?.emailAddress || "غير محدد",
          phone: order.phoneNumber,
        },
        productsDetails: orderProducts.map((item) => ({
          productId: item.product?._id || null,
          name: item.product?.name || "",
          price: item.price || item.product?.price || 0,
          images: item.product?.images || [],
          quantity: item.quantity,
          totalPrice: (item.price || item.product?.price || 0) * item.quantity,
        })),
      };
    });

    return res.status(200).json(enhancedOrders);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};


// controllers/order.controller.js

const isHttpUrl = (v) => typeof v === "string" && /^https?:\/\//i.test(v);

export const approveBankakPayment = async (req, res) => {
  const { id } = req.params;

  try {
    const order = await Order.findById(id);
    if (!order) return sendError(res, { message: "Order not found", statusCode: 404 });

    // لازم يكون BANKAK + عنده proof
    if (order.paymentMethod !== "BANKAK") {
      return sendError(res, { message: "Not a BANKAK order", statusCode: 400 });
    }
    if (!order.transferProof || !isHttpUrl(order.transferProof)) {
      return sendError(res, { message: "Missing transfer proof", statusCode: 400 });
    }

    order.paymentStatus = "PAID";
    order.bankakApproval = {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedBy: req.user?._id || req.admin?._id || null, // حسب auth عندك
      reason: null,
    };

    // غالبًا مع الدفع بنكك نؤكد الطلب
    if (order.status === "PENDING") order.status = "CONFIRMED";

    await order.save();
    return sendSuccess(res, { data: order, message: "BANKAK approved" });
  } catch (e) {
    return sendError(res, { message: "Failed to approve BANKAK", details: e.message });
  }
};

export const rejectBankakPayment = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};

  try {
    const order = await Order.findById(id);
    if (!order) return sendError(res, { message: "Order not found", statusCode: 404 });

    if (order.paymentMethod !== "BANKAK") {
      return sendError(res, { message: "Not a BANKAK order", statusCode: 400 });
    }

    order.paymentStatus = "FAILED";
    order.bankakApproval = {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedBy: req.user?._id || req.admin?._id || null,
      reason: reason || "Rejected by admin",
    };

    await order.save();
    return sendSuccess(res, { data: order, message: "BANKAK rejected" });
  } catch (e) {
    return sendError(res, { message: "Failed to reject BANKAK", details: e.message });
  }
};

// اختياري: تعديل حالة الدفع يدويًا (غير مفضل للبنكك)
export const updatePaymentStatus = async (req, res) => {
  const { id } = req.params;
  const { paymentStatus } = req.body || {};

  const allowed = ["PENDING", "PAID", "FAILED"];
  if (!allowed.includes(paymentStatus)) {
    return sendError(res, { message: "Invalid paymentStatus", statusCode: 400 });
  }

  try {
    const order = await Order.findByIdAndUpdate(
      id,
      { paymentStatus },
      { new: true }
    );

    if (!order) return sendError(res, { message: "Order not found", statusCode: 404 });
    return sendSuccess(res, { data: order, message: "Payment status updated" });
  } catch (e) {
    return sendError(res, { message: "Failed to update payment status", details: e.message });
  }
};


// Get merchant order statistics
// Merchant can update order status for orders containing their products
export const updateMerchantOrderStatus = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const merchant = await Merchant.findOne({ clerkId: userId, status: "APPROVED" });
    if (!merchant) return res.status(403).json({ message: "Merchant not found or not approved" });

    const { status } = req.body;
    const { id } = req.params;

    const allowedStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

    const updateData = {};

    if (status !== undefined) {
      // Convert frontend statuses to backend compatible ones if needed
      let normalizedStatus = status;
      if (status === "PROCESSING") normalizedStatus = "confirmed";
      if (status === "AWAITING_PAYMENT_CONFIRMATION") normalizedStatus = "pending";
      if (status === "PAYMENT_FAILED") normalizedStatus = "cancelled";

      if (!allowedStatuses.includes(normalizedStatus)) {
        return sendError(res, {
          message: "Invalid status value",
          code: "INVALID_STATUS",
          statusCode: 400,
          details: { allowedStatuses },
        });
      }
      updateData.status = normalizedStatus;
    }

    if (Object.keys(updateData).length === 0) {
      return sendError(res, {
        message: "No valid data to update",
        code: "NO_UPDATE_DATA",
        statusCode: 400,
      });
    }

    // Check if the order contains this merchant's products
    const order = await Order.findById(id)
      .populate("products.product", "merchant")
      .populate("merchants");

    if (!order) return sendNotFound(res, "Order");

    // Check if merchant is associated with this order
    const merchantInOrder = order.merchants?.some(m => String(m._id) === String(merchant._id));
    if (!merchantInOrder) {
      return sendForbidden(res, "You can only update orders that contain your products");
    }

    const oldStatus = order.status;

    const updatedOrder = await Order.findByIdAndUpdate(id, updateData, { new: true })
      .populate("products.product", "merchant")
      .populate("merchants");

    // Send status change notification
    if (status && status !== oldStatus) {
      handleOrderStatusChanged(order._id, oldStatus, status).catch((error) => {
        logger.error("Failed to send order status change notification", {
          error: error.message,
          orderId: order._id.toString(),
          oldStatus,
          newStatus: status,
        });
      });
    }

    return sendSuccess(res, { data: updatedOrder, message: "Order status updated successfully" });
  } catch (error) {
    logger.error("Error updating merchant order status", {
      error: error instanceof Error ? error.message : "Unknown error",
      orderId: req.params.id,
      merchantId: req.userId,
    });
    throw error;
  }
};

export const getMerchantOrderStats = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const merchant = await Merchant.findOne({ clerkId: userId, status: "APPROVED" });
    if (!merchant) return res.status(403).json({ message: "Merchant not found or not approved" });

    const orders = await Order.find({ merchants: merchant._id }).populate("products.product", "merchant price");

    const stats = {
      totalOrders: orders.length,
      totalRevenue: 0,
      statusStats: { pending: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0 },
      revenueByStatus: { pending: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0 },
    };

    orders.forEach((order) => {
      const merchantRevenueEntry = order.merchantRevenue?.find(
        (mr) => String(mr.merchant) === String(merchant._id)
      );

      const merchantRevenue = merchantRevenueEntry?.amount || 0;

      stats.totalRevenue += merchantRevenue;

      if (stats.statusStats[order.status] !== undefined) {
        stats.statusStats[order.status] += 1;
        stats.revenueByStatus[order.status] += merchantRevenue;
      }
    });

    return res.status(200).json(stats);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
