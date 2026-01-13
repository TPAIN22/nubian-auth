import Order from "../models/orders.model.js";
import Cart from "../models/carts.model.js";
import Product from "../models/product.model.js";
import Merchant from "../models/merchant.model.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";
import { sendOrderEmail } from "../lib/mail.js";
import Coupon from "../models/coupon.model.js";
import Marketer from "../models/marketer.model.js";
import logger from "../lib/logger.js";
import { sendSuccess, sendError, sendCreated, sendNotFound, sendUnauthorized, sendForbidden } from '../lib/response.js';
import { getProductPrice, mapToObject } from '../utils/cartUtils.js';
import { handleOrderCreated, handleOrderStatusChanged } from '../services/notificationEventHandlers.js';

export const updateOrderStatus = async (req, res) => {
  try {
    const { status, paymentStatus } = req.body;
    const { id } = req.params;

    const allowedStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
    const allowedPaymentStatus = ["pending", "paid", "failed"];

    const updateData = {};

    if (status !== undefined) {
      if (!allowedStatuses.includes(status)) {
        return sendError(res, {
          message: "Invalid status value",
          code: 'INVALID_STATUS',
          statusCode: 400,
          details: { allowedStatuses },
        });
      }
      updateData.status = status;
    }

    if (paymentStatus !== undefined) {
      if (!allowedPaymentStatus.includes(paymentStatus)) {
        return sendError(res, {
          message: "Invalid payment status value",
          code: 'INVALID_PAYMENT_STATUS',
          statusCode: 400,
          details: { allowedPaymentStatus },
        });
      }
      updateData.paymentStatus = paymentStatus;
    }

    if (Object.keys(updateData).length === 0) {
      return sendError(res, {
        message: "No valid data to update",
        code: 'NO_UPDATE_DATA',
        statusCode: 400,
      });
    }

    const oldOrder = await Order.findById(id)
      .populate("products.product", "name price images category description stock")
      .populate("user", "fullName emailAddress phoneNumber")
      .populate("merchants");
    
    if (!oldOrder) {
      return sendNotFound(res, 'Order');
    }

    const oldStatus = oldOrder.status;
    const order = await Order.findByIdAndUpdate(id, updateData, { new: true })
      .populate("products.product", "name price images category description stock")
      .populate("user", "fullName emailAddress phoneNumber")
      .populate("merchants");

    // حساب العمولة فقط عند التسليم لأول مرة
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

    // Trigger notification for order status change
    if (status && status !== oldStatus) {
      // Fire and forget - don't block the response if notification fails
      handleOrderStatusChanged(order._id, oldStatus, status).catch((error) => {
        logger.error('Failed to send order status change notification', {
          error: error.message,
          orderId: order._id.toString(),
          oldStatus,
          newStatus: status,
        });
      });
    }

    return sendSuccess(res, {
      data: order,
      message: 'Order status updated successfully',
    });
  } catch (error) {
    // Let error handler middleware handle the response
    throw error;
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
        select: "name price discountPrice images category description stock createdAt",
      })
      .populate("user", "fullName emailAddress phoneNumber")
      .populate("coupon", "code type value")
      .sort({ orderDate: -1 });

    const enhancedOrders = orders.map((order) => ({
      ...order.toObject(),
      productsCount: order.products.length,
      productsDetails: order.products.map((item) => {
        // Use stored price from order (final price at time of order) or fallback to product finalPrice
        // The order stores the final selling price (finalPrice > discountPrice > price)
        const finalPrice = item.price || item.product?.finalPrice || item.product?.discountPrice || item.product?.price || 0;
        const merchantPrice = item.merchantPrice || item.product?.merchantPrice || item.product?.price || 0;
        return {
          productId: item.product?._id || null,
          name: item.product?.name || "",
          price: finalPrice, // Final price charged (finalPrice > discountPrice > price)
          merchantPrice: merchantPrice, // Base merchant price
          discountPrice: item.discountPrice || item.product?.discountPrice, // Legacy discountPrice for display
          originalPrice: merchantPrice, // Original merchant price before markups
          nubianMarkup: item.nubianMarkup || item.product?.nubianMarkup || 10, // Nubian markup percentage
          dynamicMarkup: item.dynamicMarkup || item.product?.dynamicMarkup || 0, // Dynamic markup at time of order
          images: item.product?.images || [],
          category: item.product?.category || "",
          description: item.product?.description || "",
          stock: item.product?.stock || 0,
          quantity: item.quantity,
          totalPrice: finalPrice * item.quantity,
        };
      }),
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

    const cart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      populate: {
        path: "merchant",
      },
    });
    if (!cart || cart.products.length === 0) {
      return res.status(400).json({ message: "Cart is empty or not found" });
    }

    // Build orderProducts with pricing breakdown (will be populated in the loop below)
    const orderProducts = [];

    // Use cart.totalPrice which is already calculated correctly using getProductPrice
    // But recalculate to get per-item prices for merchant tracking and consistency
    let totalAmount = 0;

    // Track merchants and calculate merchant revenue
    const merchantMap = new Map(); // merchantId -> { amount, products }
    const merchantIds = new Set();
    const unmerchantedProducts = []; // Track products without merchants
    let merchantTotalAmount = 0; // Total amount from products WITH merchants
    let platformTotalAmount = 0; // Total amount from products WITHOUT merchants
    
    for (const item of cart.products) {
      // Get attributes from cart item to calculate correct price (for variant products)
      let itemAttributes = {};
      if (item.attributes && item.attributes instanceof Map) {
        itemAttributes = mapToObject(item.attributes);
      } else if (item.size) {
        // Legacy: convert size to attributes format
        itemAttributes = { size: item.size };
      }
      
      // Use getProductPrice to get final price (finalPrice > discountPrice > price)
      const itemPrice = getProductPrice(item.product, itemAttributes);
      const itemMerchantPrice = item.product.merchantPrice || item.product.price || 0;
      const itemNubianMarkup = item.product.nubianMarkup || 10;
      const itemDynamicMarkup = item.product.dynamicMarkup || 0;
      const itemTotal = itemPrice * item.quantity;
      totalAmount += itemTotal;
      
      // Add to orderProducts with pricing breakdown
      orderProducts.push({
        product: item.product._id,
        quantity: item.quantity,
        price: itemPrice, // Final price charged (finalPrice > discountPrice > price)
        merchantPrice: itemMerchantPrice, // Base merchant price
        nubianMarkup: itemNubianMarkup, // Nubian markup at time of order
        dynamicMarkup: itemDynamicMarkup, // Dynamic markup at time of order
        discountPrice: item.product.discountPrice || undefined, // Legacy discountPrice
        originalPrice: itemMerchantPrice, // Original merchant price
      });
      
      const productMerchant = item.product.merchant;
      
      if (productMerchant) {
        const merchantId = productMerchant._id ? productMerchant._id.toString() : productMerchant.toString();
        merchantIds.add(merchantId);
        merchantTotalAmount += itemTotal;
        
        if (!merchantMap.has(merchantId)) {
          merchantMap.set(merchantId, { amount: 0, products: [] });
        }
        const merchantData = merchantMap.get(merchantId);
        merchantData.amount += itemTotal;
        merchantData.products.push({
          product: item.product._id,
          quantity: item.quantity,
          price: itemPrice, // Final price (finalPrice > discountPrice > price)
          merchantPrice: itemMerchantPrice, // Base merchant price
          nubianMarkup: itemNubianMarkup, // Nubian markup at time of order
          dynamicMarkup: itemDynamicMarkup, // Dynamic markup at time of order
        });
      } else {
        // Track products without merchants
        platformTotalAmount += itemTotal;
        unmerchantedProducts.push({
          product: item.product._id,
          name: item.product.name,
          quantity: item.quantity,
          price: itemPrice, // Final price (finalPrice > discountPrice > price)
          merchantPrice: itemMerchantPrice,
          total: itemTotal,
        });
      }
    }
    
    // Use cart.totalPrice if it exists and matches our calculation (for consistency)
    // Otherwise use our calculated totalAmount
    if (cart.totalPrice && Math.abs(cart.totalPrice - totalAmount) < 0.01) {
      totalAmount = cart.totalPrice;
    }

    // Log warning if unmerchanted products are found
    if (unmerchantedProducts.length > 0) {
      logger.warn('Order contains products without merchants', {
        requestId: req.requestId,
        orderNumber: formattedOrderNumber,
        unmerchantedCount: unmerchantedProducts.length,
        platformTotalAmount,
        products: unmerchantedProducts.map(p => ({
          productId: p.product.toString(),
          name: p.name,
          quantity: p.quantity,
        })),
      });
    }

    let discountAmount = 0;
    let couponId = null;
    let couponDetails = null;

    // Enhanced Coupon System with Smart Pricing Integration
    if (req.body.couponCode) {
      const couponCode = req.body.couponCode.toUpperCase().trim();
      const coupon = await Coupon.findOne({
        code: couponCode,
        isActive: true,
      });

      if (!coupon) {
        return sendError(res, { message: "Invalid or inactive coupon code" }, 400);
      }

      // Validate dates
      const now = new Date();
      const startDate = coupon.startDate || new Date(0); // Default to epoch if not set
      const endDate = coupon.endDate || coupon.expiresAt;

      if (startDate > now) {
        return sendError(res, { message: "Coupon is not yet active" }, 400);
      }
      if (endDate < now) {
        return sendError(res, { message: "Coupon has expired" }, 400);
      }

      // Validate global usage limit
      const usageLimit = coupon.usageLimitGlobal || coupon.usageLimit;
      if (usageLimit !== null && usageLimit > 0 && coupon.usageCount >= usageLimit) {
        return sendError(res, { message: "Coupon usage limit reached" }, 400);
      }

      // Validate user usage limit
      const userUsedCount = coupon.usedBy.filter(
        (u) => u.toString() === user._id.toString()
      ).length;
      if (coupon.usageLimitPerUser > 0 && userUsedCount >= coupon.usageLimitPerUser) {
        return sendError(res, { 
          message: "You have already used this coupon the maximum allowed times" 
        }, 400);
      }

      // Validate minimum order amount
      if (coupon.minOrderAmount > 0 && totalAmount < coupon.minOrderAmount) {
        return sendError(res, { 
          message: `Minimum order amount of ${coupon.minOrderAmount} required` 
        }, 400);
      }

      // Validate product eligibility
      if (coupon.applicableProducts && coupon.applicableProducts.length > 0) {
        const applicableProductIds = coupon.applicableProducts.map(p => p.toString());
        const cartProductIds = cart.products.map(item => item.product._id.toString());
        const hasEligibleProduct = cartProductIds.some(pid => applicableProductIds.includes(pid));
        
        if (!hasEligibleProduct) {
          return sendError(res, { message: "Coupon is not valid for selected products" }, 400);
        }
      }

      // Validate category eligibility
      if (coupon.applicableCategories && coupon.applicableCategories.length > 0) {
        const applicableCategoryIds = coupon.applicableCategories.map(c => c.toString());
        const cartCategoryIds = cart.products
          .map(item => item.product.category?.toString())
          .filter(Boolean);
        const hasEligibleCategory = cartCategoryIds.some(cid => applicableCategoryIds.includes(cid));
        
        if (!hasEligibleCategory) {
          return sendError(res, { message: "Coupon is not valid for selected product categories" }, 400);
        }
      }

      // Validate merchant eligibility
      if (coupon.applicableMerchants && coupon.applicableMerchants.length > 0) {
        const applicableMerchantIds = coupon.applicableMerchants.map(m => m.toString());
        const cartMerchantIds = cart.products
          .map(item => {
            const merchant = item.product.merchant;
            return merchant?._id?.toString() || merchant?.toString();
          })
          .filter(Boolean);
        const hasEligibleMerchant = cartMerchantIds.some(mid => applicableMerchantIds.includes(mid));
        
        if (!hasEligibleMerchant) {
          return sendError(res, { message: "Coupon is not valid for selected merchants" }, 400);
        }
      }

      // Calculate discount using coupon method (handles minOrderAmount, maxDiscount, etc.)
      discountAmount = coupon.calculateDiscount(totalAmount);

      // Store coupon details for order
      couponId = coupon._id;
      couponDetails = {
        code: coupon.code,
        type: coupon.type || coupon.discountType,
        value: coupon.value || coupon.discountValue,
        discountAmount,
      };

      // Update coupon usage
      coupon.usedBy.push(user._id);
      coupon.usageCount = (coupon.usageCount || 0) + 1;
      coupon.totalDiscountGiven = (coupon.totalDiscountGiven || 0) + discountAmount;
      coupon.totalOrders = (coupon.totalOrders || 0) + 1;
      await coupon.save();

      logger.info('Coupon applied to order', {
        requestId: req.requestId,
        couponId: coupon._id,
        couponCode: coupon.code,
        discountAmount,
        totalAmount,
        userId: user._id,
      });
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

    // Calculate merchant revenue (proportional to their products' share)
    // Only apply discount to merchant products, not platform products
    const merchantRevenue = Array.from(merchantMap.entries()).map(([merchantId, data]) => {
      // Calculate merchant's share of the discount proportionally
      // Use merchantTotalAmount instead of totalAmount to exclude platform products from discount calculation
      // This ensures discounts only reduce merchant revenue, not platform revenue
      const merchantDiscount = merchantTotalAmount > 0 
        ? (data.amount / merchantTotalAmount) * discountAmount
        : 0;
      const merchantFinalAmount = data.amount - merchantDiscount;
      
      return {
        merchant: merchantId,
        amount: Math.max(0, merchantFinalAmount),
      };
    });

    // Log data integrity check
    if (merchantTotalAmount + platformTotalAmount !== totalAmount) {
      logger.error('Order amount mismatch detected', {
        requestId: req.requestId,
        orderNumber: formattedOrderNumber,
        totalAmount,
        merchantTotalAmount,
        platformTotalAmount,
        sum: merchantTotalAmount + platformTotalAmount,
        difference: totalAmount - (merchantTotalAmount + platformTotalAmount),
      });
    }

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
      couponDetails: couponDetails || null,
      paymentMethod: req.body.paymentMethod,
      orderNumber: formattedOrderNumber,
      phoneNumber: delivery.phone,
      city: delivery.city,
      address: addressString,
      marketer: req.body.marketerCode
        ? (await Marketer.findOne({ code: req.body.marketerCode.toUpperCase() }))?._id
        : null,
      marketerCommission: 0, // هتحسب لاحقًا عند التسليم
      merchants: Array.from(merchantIds),
      merchantRevenue: merchantRevenue,
    });

    await Cart.findOneAndDelete({ user: user._id });

    try {
      await sendOrderEmail({
        to: user.emailAddress || user.email,
        userName: user.fullName || user.name || "",
        orderNumber: formattedOrderNumber,
        status: "بانتظار التأكيد",
        totalAmount: finalAmount,
        products: cart.products.map((item) => {
          // Get attributes to calculate correct price
          let itemAttributes = {};
          if (item.attributes && item.attributes instanceof Map) {
            itemAttributes = mapToObject(item.attributes);
          } else if (item.size) {
            itemAttributes = { size: item.size };
          }
          const itemPrice = getProductPrice(item.product, itemAttributes);
          return {
            name: item.product.name,
            quantity: item.quantity,
            price: itemPrice, // Final price (discountPrice if exists, else price)
          };
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

    // Trigger notification for order creation (fire and forget)
    handleOrderCreated(order._id).catch((error) => {
      logger.error('Failed to send order created notification', {
        error: error.message,
        orderId: order._id.toString(),
      });
    });

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
        select: "name price discountPrice images category description stock createdAt",
      })
      .populate("coupon", "code type value")
      .sort({ orderDate: -1 });

    const enhancedOrders = orders.map((order) => ({
      ...order.toObject(),
      productsCount: order.products.length,
      customerInfo: {
        name: order.user?.fullName || "غير محدد",
        email: order.user?.emailAddress || "غير محدد",
        phone: order.phoneNumber,
      },
      productsDetails: order.products.map((item) => {
        // Use stored pricing from order (historical pricing at time of order)
        // This ensures accurate pricing even if product prices change later
        const finalPrice = item.price || item.product?.finalPrice || item.product?.discountPrice || item.product?.price || 0;
        const merchantPrice = item.merchantPrice || item.product?.merchantPrice || item.product?.price || 0;
        const nubianMarkup = item.nubianMarkup || item.product?.nubianMarkup || 10;
        const dynamicMarkup = item.dynamicMarkup || item.product?.dynamicMarkup || 0;
        
        return {
          productId: item.product?._id || null,
          name: item.product?.name || "",
          price: finalPrice, // Final price charged (stored at time of order)
          merchantPrice: merchantPrice, // Base merchant price at time of order
          originalPrice: merchantPrice, // Original merchant price before markups
          discountPrice: item.discountPrice || item.product?.discountPrice || undefined, // Legacy discountPrice
          nubianMarkup: nubianMarkup, // Nubian markup at time of order
          dynamicMarkup: dynamicMarkup, // Dynamic markup at time of order
          pricingBreakdown: {
            merchantPrice: merchantPrice,
            nubianMarkup: nubianMarkup,
            dynamicMarkup: dynamicMarkup,
            finalPrice: finalPrice,
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
        select: "name price discountPrice images category description stock createdAt updatedAt",
      })
      .populate("coupon", "code type value");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.user._id.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    const enhancedOrder = {
      ...order.toObject(),
      productsCount: order.products.length,
      productsDetails: order.products.map((item) => {
        // Use stored pricing from order (historical pricing at time of order)
        const finalPrice = item.price || item.product?.finalPrice || item.product?.discountPrice || item.product?.price || 0;
        const merchantPrice = item.merchantPrice || item.product?.merchantPrice || item.product?.price || 0;
        const nubianMarkup = item.nubianMarkup || item.product?.nubianMarkup || 10;
        const dynamicMarkup = item.dynamicMarkup || item.product?.dynamicMarkup || 0;
        
        return {
          productId: item.product?._id || null,
          name: item.product?.name || "",
          price: finalPrice, // Final price charged (stored at time of order)
          merchantPrice: merchantPrice, // Base merchant price at time of order
          originalPrice: merchantPrice, // Original merchant price before markups
          discountPrice: item.discountPrice || item.product?.discountPrice || undefined, // Legacy discountPrice
          nubianMarkup: nubianMarkup, // Nubian markup at time of order
          dynamicMarkup: dynamicMarkup, // Dynamic markup at time of order
          pricingBreakdown: {
            merchantPrice: merchantPrice,
            nubianMarkup: nubianMarkup,
            dynamicMarkup: dynamicMarkup,
            finalPrice: finalPrice,
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

// Get merchant's orders
export const getMerchantOrders = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });
    if (!merchant) {
      return res.status(403).json({ message: 'Merchant not found or not approved' });
    }
    
    const { status } = req.query;
    
    // Build filter - status is validated by middleware
    const filter = { merchants: merchant._id };
    if (status) {
      filter.status = status; // Safe: validated as one of allowed statuses
    }
    
    const orders = await Order.find(filter)
      .populate({
        path: 'user',
        select: 'fullName emailAddress phoneNumber',
      })
      .populate({
        path: 'products.product',
        select: 'name price images category description stock merchant',
        populate: {
          path: 'merchant',
          select: 'businessName',
        },
      })
      .sort({ orderDate: -1 });
    
    // Filter products to only show merchant's products and calculate merchant revenue
    const enhancedOrders = orders.map((order) => {
      const merchantProducts = order.products.filter((item) => {
        const productMerchant = item.product?.merchant;
        return productMerchant && productMerchant._id.toString() === merchant._id.toString();
      });
      
      const merchantRevenueEntry = order.merchantRevenue?.find(
        (mr) => mr.merchant.toString() === merchant._id.toString()
      );
      
      const merchantOrderTotal = merchantProducts.reduce((sum, item) => {
        return sum + (item.product?.price || 0) * item.quantity;
      }, 0);
      
      return {
        ...order.toObject(),
        products: merchantProducts,
        productsCount: merchantProducts.length,
        merchantRevenue: merchantRevenueEntry?.amount || merchantOrderTotal,
        customerInfo: {
          name: order.user?.fullName || 'غير محدد',
          email: order.user?.emailAddress || 'غير محدد',
          phone: order.phoneNumber,
        },
        productsDetails: merchantProducts.map((item) => ({
          productId: item.product?._id || null,
          name: item.product?.name || '',
          price: item.product?.price || 0,
          images: item.product?.images || [],
          quantity: item.quantity,
          totalPrice: (item.product?.price || 0) * item.quantity,
        })),
      };
    });
    
    res.status(200).json(enhancedOrders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get merchant order statistics
export const getMerchantOrderStats = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    const merchant = await Merchant.findOne({ clerkId: userId, status: 'APPROVED' });
    if (!merchant) {
      return res.status(403).json({ message: 'Merchant not found or not approved' });
    }
    
    const orders = await Order.find({ merchants: merchant._id })
      .populate('products.product', 'merchant price');
    
    const stats = {
      totalOrders: orders.length,
      totalRevenue: 0,
      statusStats: {
        pending: 0,
        confirmed: 0,
        shipped: 0,
        delivered: 0,
        cancelled: 0,
      },
      revenueByStatus: {
        pending: 0,
        confirmed: 0,
        shipped: 0,
        delivered: 0,
        cancelled: 0,
      },
    };
    
    orders.forEach((order) => {
      const merchantRevenueEntry = order.merchantRevenue?.find(
        (mr) => mr.merchant.toString() === merchant._id.toString()
      );
      
      const merchantRevenue = merchantRevenueEntry?.amount || 0;
      
      stats.totalRevenue += merchantRevenue;
      stats.statusStats[order.status] = (stats.statusStats[order.status] || 0) + 1;
      stats.revenueByStatus[order.status] = (stats.revenueByStatus[order.status] || 0) + merchantRevenue;
    });
    
    res.status(200).json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
