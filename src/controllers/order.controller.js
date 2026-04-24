import Order from "../models/orders.model.js";
import Merchant from "../models/merchant.model.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";
import { sendOrderEmail } from "../lib/mail.js";
import CommissionService from "../services/commission.service.js";
import logger from "../lib/logger.js";
import { sendSuccess, sendError, sendNotFound, sendForbidden, sendPaginated, sendCreated } from "../lib/response.js";
import { handleOrderCreated, handleOrderStatusChanged } from "../services/notificationEventHandlers.js";
import orderService from "../services/order.service.js";
import { ServiceError } from "../lib/errors.js";

// Shared display formatter used by getUserOrders, getOrders, and getOrderById.
// Always reads from the price snapshot stored on the order item — never the current
// product price — so completed orders are immutable from the customer's perspective.
function formatOrderProduct(item) {
  if (!item.product) return null;

  const snapshotFinalPrice    = item.price || 0;
  const snapshotMerchantPrice = item.merchantPrice || 0;
  const snapshotMarkup        = item.nubianMarkup || 10;

  const rawOriginal          = snapshotMerchantPrice > 0
    ? snapshotMerchantPrice * (1 + snapshotMarkup / 100)
    : 0;
  const displayFinalPrice    = snapshotFinalPrice;
  const displayOriginalPrice = rawOriginal > snapshotFinalPrice ? rawOriginal : snapshotFinalPrice;
  const displayDiscountPercentage = displayOriginalPrice > snapshotFinalPrice
    ? Math.round(((displayOriginalPrice - snapshotFinalPrice) / displayOriginalPrice) * 100)
    : 0;

  return {
    productId:     item.product._id,
    name:          item.product.name          || "",
    price:         displayFinalPrice,
    merchantPrice: snapshotMerchantPrice,
    originalPrice: displayOriginalPrice,
    discountPrice: item.discountPrice         || item.product.discountPrice || null,
    nubianMarkup:  snapshotMarkup,
    dynamicMarkup: item.dynamicMarkup         || item.product.dynamicMarkup || 0,
    pricingBreakdown: {
      merchantPrice: snapshotMerchantPrice,
      nubianMarkup:  snapshotMarkup,
      dynamicMarkup: item.dynamicMarkup || 0,
      finalPrice:    displayFinalPrice,
    },
    images:      item.product.images      || [],
    category:    item.product.category    || "",
    description: item.product.description || "",
    stock:       item.product.stock       || 0,
    isAvailable: (item.product.stock      || 0) > 0,
    quantity:    item.quantity,
    totalPrice:  displayFinalPrice * item.quantity,
    attributes:  item.attributes  || null,
    size:        item.size        || null,
    variantId:   item.variantId   || null,
    displayFinalPrice,
    displayOriginalPrice,
    displayDiscountPercentage,
  };
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
      const allowedPaymentStatuses = ["pending", "paid", "failed"];
      if (!allowedPaymentStatuses.includes(paymentStatus)) {
        return sendError(res, {
          message: "Invalid payment status value",
          code: "INVALID_PAYMENT_STATUS",
          statusCode: 400,
          details: { allowedPaymentStatuses },
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
      order.marketer
    ) {
      try {
        await CommissionService.createCommission(order._id);
        logger.info(`Commission record created for delivered order: ${order.orderNumber}`);
      } catch (commError) {
        logger.error(`Failed to create commission for order ${order._id}:`, commError);
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
    logger.error("Error updating order status", { orderId: req.params.id, error: error.message });
    return sendError(res, { message: "Failed to update order status", statusCode: 500 });
  }
};

export const getUserOrders = async (req, res) => {
  const { userId } = getAuth(req);

  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) return sendNotFound(res, "User");

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip  = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ user: user._id })
        .populate({
          path: "products.product",
          select: "name price discountPrice images category description stock createdAt",
        })
        .populate("user", "fullName emailAddress phoneNumber")
        .populate("coupon", "code type value")
        .sort({ orderDate: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments({ user: user._id }),
    ]);

    const enhancedOrders = orders.map((order) => ({
      ...order.toObject(),
      transferProof:  order.transferProof || null,
      productsCount:  order.products.length,
      productsDetails: order.products.map(formatOrderProduct).filter(Boolean),
    }));

    return sendPaginated(res, { data: enhancedOrders, page, limit, total });
  } catch (error) {
    return sendError(res, { message: "Failed to retrieve orders", statusCode: 500 });
  }
};

export const createOrder = async (req, res) => {
  const { userId } = getAuth(req);

  // HTTP-boundary check: transferProof URL domain must be validated before
  // entering the service, as it depends on the IMAGEKIT_URL_ENDPOINT env var.
  const rawPaymentMethod = String(req.body.paymentMethod || '').trim().toUpperCase();
  if (rawPaymentMethod === 'BANKAK') {
    const proof = req.body.transferProof || req.body.paymentProofUrl || null;
    if (!isValidProofUrl(proof)) {
      return sendError(res, {
        message: 'transferProof must be a valid HTTPS URL from the approved image host',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        details: [{ field: 'transferProof', message: 'Must be a valid HTTPS URL from the approved image host', value: proof || '' }],
      });
    }
  }

  try {
    const { order, emailPayload } = await orderService.createOrder(userId, req.body, req.ip);

    sendOrderEmail({ ...emailPayload, status: 'بانتظار التأكيد' }).catch((err) => {
      logger.error('Failed to send order email', { requestId: req.requestId, error: err.message, orderNumber: order.orderNumber });
    });

    handleOrderCreated(order._id).catch((err) => {
      logger.error('Failed to send order created notification', { error: err.message, orderId: order._id.toString() });
    });

    return sendCreated(res, order, 'Order created successfully');
  } catch (error) {
    if (error.name === 'ServiceError') {
      return sendError(res, { message: error.message, code: error.code, statusCode: error.statusCode, details: error.details });
    }
    logger.error('Error creating order', { requestId: req.requestId, error: error.message });
    return sendError(res, { message: 'Failed to create order', statusCode: 500 });
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

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate({ path: "user", select: "fullName emailAddress phoneNumber" })
        .populate({
          path: "products.product",
          select: "name price discountPrice images category description stock createdAt",
        })
        .populate("merchants", "businessName")
        .populate("coupon", "code type value")
        .sort({ orderDate: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    const enhancedOrders = orders.map((order) => ({
      ...order.toObject(),
      transferProof: order.transferProof || null,
      productsCount: order.products.length,
      customerInfo: {
        name: order.user?.fullName || "غير محدد",
        email: order.user?.emailAddress || "غير محدد",
        phone: order.phoneNumber,
      },
      productsDetails: order.products.map(formatOrderProduct).filter(Boolean),
      orderSummary: {
        subtotal: order.totalAmount,
        discount: order.discountAmount,
        total:    order.finalAmount,
      },
    }));

    return sendPaginated(res, { data: enhancedOrders, page, limit, total });
  } catch (error) {
    return sendError(res, { message: "Failed to retrieve orders", statusCode: 500 });
  }
};

export const getOrderById = async (req, res) => {
  const { userId } = getAuth(req);

  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) return sendNotFound(res, "User");

    // Scope query to the authenticated user — prevents IDOR (order existence must not
    // be revealed to non-owners via a 403 vs 404 distinction).
    const order = await Order.findOne({ _id: req.params.id, user: user._id })
      .populate("user", "fullName emailAddress phoneNumber")
      .populate({
        path: "products.product",
        select: "name price discountPrice images category description stock createdAt updatedAt",
      })
      .populate("coupon", "code type value");

    if (!order) return sendNotFound(res, "Order");

    const enhancedOrder = {
      ...order.toObject(),
      transferProof:   order.transferProof || null,
      productsCount:   order.products.length,
      productsDetails: order.products.map(formatOrderProduct).filter(Boolean),
      orderSummary: {
        subtotal: order.totalAmount,
        discount: order.discountAmount,
        total:    order.finalAmount,
      },
    };

    return sendSuccess(res, { data: enhancedOrder });
  } catch (error) {
    return sendError(res, { message: "Failed to retrieve order", statusCode: 500 });
  }
};

// Get merchant's orders
export const getMerchantOrders = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return sendError(res, { message: "Unauthorized", statusCode: 401, code: "UNAUTHORIZED" });

    const merchant = await Merchant.findOne({ clerkId: userId, status: "APPROVED" });
    if (!merchant) return sendError(res, { message: "Merchant not found or not approved", statusCode: 403, code: "FORBIDDEN" });

    const { status } = req.query;

    const filter = { merchants: merchant._id };
    if (status) filter.status = status;

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip  = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate({ path: "user", select: "fullName emailAddress phoneNumber" })
        .populate({
          path: "products.product",
          select: "name price images category description stock merchant",
          populate: { path: "merchant", select: "businessName" },
        })
        .sort({ orderDate: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    const enhancedOrders = orders.map((order) => {
      // Only expose this merchant's own products — not competitors' items in the same order.
      const orderProducts = (order.products || []).filter((item) => {
        if (!item.product) return false;
        const m = item.product.merchant;
        if (!m) return false;
        return (m._id ? m._id.toString() : m.toString()) === String(merchant._id);
      });

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
          attributes: item.attributes || null,
          size: item.size || null,
          variantId: item.variantId || null,
        })),
      };
    });

    return sendPaginated(res, { data: enhancedOrders, page, limit, total });
  } catch (error) {
    return sendError(res, { message: "Failed to retrieve merchant orders", statusCode: 500 });
  }
};


// Transfer proof must come from the configured image CDN — rejects off-domain fakes.
const ALLOWED_PROOF_ORIGINS = (process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/nubian')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isValidProofUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      ALLOWED_PROOF_ORIGINS.some((origin) => url.startsWith(origin))
    );
  } catch {
    return false;
  }
}

export const approveBankakPayment = async (req, res) => {
  const { id } = req.params;

  try {
    const order = await Order.findById(id);
    if (!order) return sendError(res, { message: "Order not found", statusCode: 404 });

    // لازم يكون BANKAK + عنده proof
    if (order.paymentMethod !== "BANKAK") {
      return sendError(res, { message: "Not a BANKAK order", statusCode: 400 });
    }
    if (!isValidProofUrl(order.transferProof)) {
      return sendError(res, { message: "Missing transfer proof", statusCode: 400 });
    }

    order.paymentStatus = "paid";
    order.bankakApproval = {
      status: "approved",
      approvedAt: new Date(),
      approvedBy: req.adminUser?.userId || null,
      reason: null,
    };

    if (order.status === "pending") order.status = "confirmed";

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

    order.paymentStatus = "failed";
    order.bankakApproval = {
      status: "rejected",
      rejectedAt: new Date(),
      rejectedBy: req.adminUser?.userId || null,
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

  const allowed = ["pending", "paid", "failed"];
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
    if (!userId) return sendError(res, { message: "Unauthorized", statusCode: 401, code: "UNAUTHORIZED" });

    const merchant = await Merchant.findOne({ clerkId: userId, status: "APPROVED" });
    if (!merchant) return sendError(res, { message: "Merchant not found or not approved", statusCode: 403, code: "FORBIDDEN" });

    const { status } = req.body;
    const { id } = req.params;

    // Merchants may only advance an order to confirmed or shipped.
    // pending/delivered/cancelled are platform-only transitions — allowing merchants
    // to set "delivered" enables commission fraud; "cancelled" enables unilateral refusals.
    const MERCHANT_ALLOWED_STATUSES = ["confirmed", "shipped"];

    const updateData = {};

    if (status !== undefined) {
      const normalizedStatus = status === "PROCESSING" ? "confirmed" : status;

      if (!MERCHANT_ALLOWED_STATUSES.includes(normalizedStatus)) {
        return sendError(res, {
          message: `Merchants can only set status to: ${MERCHANT_ALLOWED_STATUSES.join(", ")}`,
          code: "INVALID_STATUS",
          statusCode: 403,
          details: { allowedStatuses: MERCHANT_ALLOWED_STATUSES },
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
      orderId: req.params.id,
      error: error.message,
    });
    return sendError(res, { message: "Failed to update order status", statusCode: 500 });
  }
};

export const getMerchantOrderStats = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return sendError(res, { message: "Unauthorized", statusCode: 401, code: "UNAUTHORIZED" });

    const merchant = await Merchant.findOne({ clerkId: userId, status: "APPROVED" });
    if (!merchant) return sendError(res, { message: "Merchant not found or not approved", statusCode: 403, code: "FORBIDDEN" });

    // Aggregation — all arithmetic runs inside MongoDB, zero documents loaded into Node.js memory.
    const [statusAgg, revenueAgg] = await Promise.all([
      Order.aggregate([
        { $match: { merchants: merchant._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { merchants: merchant._id } },
        { $unwind: { path: "$merchantRevenue", preserveNullAndEmptyArrays: false } },
        { $match: { "merchantRevenue.merchant": merchant._id } },
        { $group: { _id: "$status", revenue: { $sum: "$merchantRevenue.amount" } } },
      ]),
    ]);

    const statusStats    = { pending: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0 };
    const revenueByStatus = { pending: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0 };
    let totalOrders = 0;
    let totalRevenue = 0;

    statusAgg.forEach(({ _id, count }) => {
      if (_id in statusStats) { statusStats[_id] = count; totalOrders += count; }
    });
    revenueAgg.forEach(({ _id, revenue }) => {
      if (_id in revenueByStatus) { revenueByStatus[_id] = revenue; totalRevenue += revenue; }
    });

    return sendSuccess(res, {
      data: { totalOrders, totalRevenue, statusStats, revenueByStatus },
      message: "Merchant order stats retrieved",
    });
  } catch (error) {
    return sendError(res, { message: "Failed to retrieve order stats", statusCode: 500 });
  }
};
