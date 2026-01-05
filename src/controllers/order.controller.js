import Order from "../models/orders.model.js";
import Cart from "../models/carts.model.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";
import { sendOrderEmail } from "../lib/mail.js";
import Coupon from "../models/coupon.model.js";
import Marketer from "../models/marketer.model.js";
import logger from "../lib/logger.js";

export const updateOrderStatus = async (req, res) => {
  try {
    const { status, paymentStatus } = req.body;
    const { id } = req.params;

    const allowedStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
    const allowedPaymentStatus = ["pending", "paid", "failed"];

    const updateData = {};

    if (status !== undefined) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      updateData.status = status;
    }

    if (paymentStatus !== undefined) {
      if (!allowedPaymentStatus.includes(paymentStatus)) {
        return res.status(400).json({ message: "Invalid payment status value" });
      }
      updateData.paymentStatus = paymentStatus;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No valid data to update" });
    }

    const oldOrder = await Order.findById(id);
    if (!oldOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = await Order.findByIdAndUpdate(id, updateData, { new: true })
      .populate("products.product", "name price images category description stock")
      .populate("user", "fullName emailAddress phoneNumber");

    // حساب العمولة فقط عند التسليم لأول مرة
    if (
      status === "delivered" &&
      oldOrder.status !== "delivered" &&
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

    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getUserOrders = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const user = await User.findOne({ clerkId: userId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const orders = await Order.find({ user: user._id })
      .populate({
        path: "products.product",
        select: "name price images category description stock createdAt",
      })
      .populate("user", "fullName emailAddress phoneNumber")
      .sort({ orderDate: -1 });

    const enhancedOrders = orders.map((order) => ({
      ...order.toObject(),
      productsCount: order.products.length,
      productsDetails: order.products.map((item) => ({
        productId: item.product?._id || null,
        name: item.product?.name || "",
        price: item.product?.price || 0,
        images: item.product?.images || [],
        category: item.product?.category || "",
        description: item.product?.description || "",
        stock: item.product?.stock || 0,
        quantity: item.quantity,
        totalPrice: (item.product?.price || 0) * item.quantity,
      })),
    }));

    res.status(200).json(enhancedOrders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createOrder = async (req, res) => {
  const { userId } = getAuth(req);

  let lastOrder = await Order.findOne().sort({ createdAt: -1 });
  if (!lastOrder) {
    lastOrder = { orderNumber: "ORD-0001" };
  }
  let nextOrderNumber = 1;
  if (lastOrder && lastOrder.orderNumber) {
    const lastNumber = parseInt(lastOrder.orderNumber.split("-")[1]);
    nextOrderNumber = lastNumber + 1;
  }
  const formattedOrderNumber = `ORD-${String(nextOrderNumber).padStart(4, "0")}`;

  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const cart = await Cart.findOne({ user: user._id }).populate("products.product");
    if (!cart || cart.products.length === 0) {
      return res.status(400).json({ message: "Cart is empty or not found" });
    }

    const orderProducts = cart.products.map((item) => ({
      product: item.product._id,
      quantity: item.quantity,
    }));

    let totalAmount = cart.products.reduce((sum, item) => {
      return sum + item.product.price * item.quantity;
    }, 0);

    let discountAmount = 0;
    let couponId = null;

    // كوبون
    if (req.body.couponCode) {
      const coupon = await Coupon.findOne({
        code: req.body.couponCode,
        isActive: true,
      });
      if (!coupon) return res.status(400).json({ message: "Invalid or inactive coupon code" });
      if (coupon.expiresAt < new Date()) return res.status(400).json({ message: "Coupon has expired" });
      if (coupon.usageLimit > 0 && coupon.usedBy.length >= coupon.usageLimit)
        return res.status(400).json({ message: "Coupon usage limit reached" });

      const userUsedCount = coupon.usedBy.filter(
        (u) => u.toString() === user._id.toString()
      ).length;
      if (coupon.usageLimitPerUser > 0 && userUsedCount >= coupon.usageLimitPerUser)
        return res.status(400).json({ message: "You have already used this coupon the maximum allowed times" });

      if (coupon.discountType === "percentage") {
        discountAmount = totalAmount * (coupon.discountValue / 100);
      } else {
        discountAmount = coupon.discountValue;
      }
      if (discountAmount > totalAmount) discountAmount = totalAmount;

      couponId = coupon._id;
      coupon.usedBy.push(user._id);
      await coupon.save();
    }

    // خصم المسوّق (بدون حساب العمولة هنا)
    if (req.body.marketerCode) {
      const marketer = await Marketer.findOne({
        code: req.body.marketerCode.toUpperCase(),
      });
      if (marketer) {
        const marketerDiscount = totalAmount * marketer.discountRate;
        discountAmount += marketerDiscount;
        if (discountAmount > totalAmount) discountAmount = totalAmount;
      }
    }

    let finalAmount = totalAmount - discountAmount;
    if (finalAmount < 0) finalAmount = 0;

    const delivery = req.body.deliveryAddress || {};
    const addressString =
      delivery.address ||
      [delivery.area, delivery.street, delivery.building].filter(Boolean).join(", ") ||
      "";

    const order = await Order.create({
      user: user._id,
      products: orderProducts,
      totalAmount,
      discountAmount,
      finalAmount,
      coupon: couponId,
      paymentMethod: req.body.paymentMethod,
      orderNumber: formattedOrderNumber,
      phoneNumber: delivery.phone,
      city: delivery.city,
      address: addressString,
      marketer: req.body.marketerCode
        ? (await Marketer.findOne({ code: req.body.marketerCode.toUpperCase() }))?._id
        : null,
      marketerCommission: 0, // هتحسب لاحقًا عند التسليم
    });

    await Cart.findOneAndDelete({ user: user._id });

    try {
      await sendOrderEmail({
        to: user.emailAddress || user.email,
        userName: user.fullName || user.name || "",
        orderNumber: formattedOrderNumber,
        status: "بانتظار التأكيد",
        totalAmount: finalAmount,
        products: cart.products.map((item) => ({
          name: item.product.name,
          quantity: item.quantity,
          price: item.product.price,
        })),
      });
    } catch (mailErr) {
      logger.error("Failed to send order email", {
        requestId: req.requestId,
        error: mailErr.message,
        stack: mailErr.stack,
        orderNumber: formattedOrderNumber,
      });
    }

    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate({
        path: "user",
        select: "fullName emailAddress phoneNumber",
      })
      .populate({
        path: "products.product",
        select: "name price images category description stock createdAt",
      })
      .sort({ orderDate: -1 });

    const enhancedOrders = orders.map((order) => ({
      ...order.toObject(),
      productsCount: order.products.length,
      customerInfo: {
        name: order.user?.fullName || "غير محدد",
        email: order.user?.emailAddress || "غير محدد",
        phone: order.phoneNumber,
      },
      productsDetails: order.products.map((item) => ({
        productId: item.product?._id || null,
        name: item.product?.name || "",
        price: item.product?.price || 0,
        images: item.product?.images || [],
        category: item.product?.category || "",
        description: item.product?.description || "",
        stock: item.product?.stock || 0,
        quantity: item.quantity,
        totalPrice: (item.product?.price || 0) * item.quantity,
      })),
      orderSummary: {
        subtotal: order.totalAmount,
        discount: order.discountAmount,
        total: order.finalAmount,
      },
    }));
    res.status(200).json(enhancedOrders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getOrderById = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const user = await User.findOne({ clerkId: userId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const order = await Order.findById(req.params.id)
      .populate("user", "fullName emailAddress phoneNumber")
      .populate({
        path: "products.product",
        select: "name price images category description stock createdAt updatedAt",
      });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.user._id.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    const enhancedOrder = {
      ...order.toObject(),
      productsCount: order.products.length,
      productsDetails: order.products.map((item) => ({
        productId: item.product?._id || null,
        name: item.product?.name || "",
        price: item.product?.price || 0,
        images: item.product?.images || [],
        category: item.product?.category || "",
        description: item.product?.description || "",
        stock: item.product?.stock || 0,
        quantity: item.quantity,
        totalPrice: (item.product?.price || 0) * item.quantity,
        isAvailable: (item.product?.stock || 0) > 0,
      })),
      orderSummary: {
        subtotal: order.totalAmount,
        discount: order.discountAmount,
        total: order.finalAmount,
      },
    };

    res.status(200).json(enhancedOrder);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getOrderStats = async (req, res) => {
  try {
    const stats = await Order.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
        },
      },
    ]);

    const totalOrders = await Order.countDocuments();
    const totalRevenue = await Order.aggregate([
      { $match: { status: { $ne: "cancelled" } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);

    res.status(200).json({
      statusStats: stats,
      totalOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
