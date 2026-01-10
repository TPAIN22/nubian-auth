import notificationService from './notificationService.js';
import Order from '../models/orders.model.js';
import Product from '../models/product.model.js';
import Cart from '../models/carts.model.js';
import logger from '../lib/logger.js';

/**
 * Event-driven notification handlers
 * These functions are called when specific events occur in the system
 */

/**
 * Handle ORDER_CREATED event
 */
export async function handleOrderCreated(orderId) {
  try {
    const order = await Order.findById(orderId)
      .populate('user')
      .populate('products.product')
      .populate('merchants');

    if (!order) {
      logger.error('Order not found for ORDER_CREATED notification', { orderId });
      return;
    }

    // Notify user about order creation
    await notificationService.createNotification({
      type: 'ORDER_CREATED',
      recipientType: 'user',
      recipientId: order.user.clerkId || order.user._id,
      title: 'Order Confirmed',
      body: `Your order #${order.orderNumber} has been placed successfully. Total: ${order.finalAmount} SDG`,
      deepLink: `/orders/${order._id}`,
      metadata: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        totalAmount: order.finalAmount,
        status: order.status,
      },
      channel: 'push',
      deduplicationKey: `ORDER_CREATED_${order._id}`,
      priority: 90,
    });

    // Notify all merchants in the order about new order
    if (order.merchants && order.merchants.length > 0) {
      for (const merchant of order.merchants) {
        // Get merchant products in this order
        const merchantProducts = order.products.filter(
          (item) => item.product?.merchant?.toString() === merchant._id.toString()
        );

        if (merchantProducts.length > 0) {
          await notificationService.createNotification({
            type: 'NEW_ORDER',
            recipientType: 'merchant',
            recipientId: merchant.clerkId || merchant._id,
            title: 'New Order Received',
            body: `You have a new order #${order.orderNumber} with ${merchantProducts.length} product(s)`,
            deepLink: `/merchant/orders/${order._id}`,
            metadata: {
              orderId: order._id.toString(),
              orderNumber: order.orderNumber,
              merchantRevenue: order.merchantRevenue?.find(
                (mr) => mr.merchant.toString() === merchant._id.toString()
              )?.amount || 0,
              productCount: merchantProducts.length,
            },
            channel: 'push',
            merchantId: merchant._id,
            deduplicationKey: `NEW_ORDER_${order._id}_${merchant._id}`,
            priority: 95, // Highest priority for merchants
          });
        }
      }
    }

    logger.info('ORDER_CREATED notifications sent', { orderId: order._id.toString() });
  } catch (error) {
    logger.error('Failed to handle ORDER_CREATED event', {
      error: error.message,
      stack: error.stack,
      orderId,
    });
  }
}

/**
 * Handle ORDER_STATUS_CHANGED event
 */
export async function handleOrderStatusChanged(orderId, oldStatus, newStatus) {
  try {
    const order = await Order.findById(orderId)
      .populate('user')
      .populate('products.product')
      .populate('merchants');

    if (!order) {
      logger.error('Order not found for ORDER_STATUS_CHANGED notification', { orderId });
      return;
    }

    let notificationType = null;
    let title = '';
    let body = '';

    switch (newStatus) {
      case 'confirmed':
      case 'accepted':
        notificationType = 'ORDER_ACCEPTED';
        title = 'Order Accepted';
        body = `Your order #${order.orderNumber} has been accepted and is being prepared`;
        break;
      case 'shipped':
        notificationType = 'ORDER_SHIPPED';
        title = 'Order Shipped';
        body = `Your order #${order.orderNumber} has been shipped and is on its way`;
        break;
      case 'delivered':
        notificationType = 'ORDER_DELIVERED';
        title = 'Order Delivered';
        body = `Your order #${order.orderNumber} has been delivered successfully`;
        break;
      case 'cancelled':
        notificationType = 'ORDER_CANCELLED';
        title = 'Order Cancelled';
        body = `Your order #${order.orderNumber} has been cancelled`;
        break;
      default:
        return; // No notification for other status changes
    }

    if (notificationType) {
      // Notify user
      await notificationService.createNotification({
        type: notificationType,
        recipientType: 'user',
        recipientId: order.user.clerkId || order.user._id,
        title,
        body,
        deepLink: `/orders/${order._id}`,
        metadata: {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          oldStatus,
          newStatus,
        },
        channel: 'push',
        deduplicationKey: `${notificationType}_${order._id}_${newStatus}`,
        priority: notificationType === 'ORDER_DELIVERED' ? 85 : 80,
      });

      logger.info('ORDER_STATUS_CHANGED notification sent', {
        orderId: order._id.toString(),
        oldStatus,
        newStatus,
        notificationType,
      });
    }
  } catch (error) {
    logger.error('Failed to handle ORDER_STATUS_CHANGED event', {
      error: error.message,
      stack: error.stack,
      orderId,
      oldStatus,
      newStatus,
    });
  }
}

/**
 * Handle PRODUCT_CREATED event (for merchant notifications)
 */
export async function handleProductCreated(productId) {
  try {
    const product = await Product.findById(productId).populate('merchant');

    if (!product || !product.merchant) {
      return;
    }

    // Product creation doesn't require immediate notification
    // It will be handled when product is approved/rejected
    logger.debug('Product created', { productId: product._id.toString() });
  } catch (error) {
    logger.error('Failed to handle PRODUCT_CREATED event', {
      error: error.message,
      productId,
    });
  }
}

/**
 * Handle PRODUCT_STATUS_CHANGED event
 */
export async function handleProductStatusChanged(productId, status) {
  try {
    const product = await Product.findById(productId).populate('merchant');

    if (!product || !product.merchant) {
      return;
    }

    if (status === 'approved') {
      await notificationService.createNotification({
        type: 'PRODUCT_APPROVED',
        recipientType: 'merchant',
        recipientId: product.merchant.clerkId || product.merchant._id,
        title: 'Product Approved',
        body: `Your product "${product.name}" has been approved and is now live`,
        deepLink: `/merchant/products/${product._id}`,
        metadata: {
          productId: product._id.toString(),
          productName: product.name,
        },
        channel: 'push',
        merchantId: product.merchant._id,
        deduplicationKey: `PRODUCT_APPROVED_${product._id}`,
        priority: 50,
      });
    } else if (status === 'rejected') {
      await notificationService.createNotification({
        type: 'PRODUCT_REJECTED',
        recipientType: 'merchant',
        recipientId: product.merchant.clerkId || product.merchant._id,
        title: 'Product Rejected',
        body: `Your product "${product.name}" has been rejected. Please check and update`,
        deepLink: `/merchant/products/${product._id}`,
        metadata: {
          productId: product._id.toString(),
          productName: product.name,
        },
        channel: 'push',
        merchantId: product.merchant._id,
        deduplicationKey: `PRODUCT_REJECTED_${product._id}`,
        priority: 55,
      });
    }

    logger.info('PRODUCT_STATUS_CHANGED notification sent', {
      productId: product._id.toString(),
      status,
    });
  } catch (error) {
    logger.error('Failed to handle PRODUCT_STATUS_CHANGED event', {
      error: error.message,
      productId,
      status,
    });
  }
}

/**
 * Handle CART_ABANDONED event (behavioral notification)
 */
export async function handleCartAbandoned(userId, cartItems) {
  try {
    if (!cartItems || cartItems.length === 0) {
      return;
    }

    const itemCount = cartItems.length;
    const totalPrice = cartItems.reduce((sum, item) => {
      return sum + (item.product?.price || 0) * item.quantity;
    }, 0);

    await notificationService.createNotification({
      type: 'CART_ABANDONED',
      recipientType: 'user',
      recipientId: userId,
      title: 'Don\'t forget your items!',
      body: `You have ${itemCount} item(s) in your cart. Complete your purchase now!`,
      deepLink: '/cart',
      metadata: {
        itemCount,
        totalPrice,
        cartItems: cartItems.map((item) => ({
          productId: item.product?._id?.toString(),
          quantity: item.quantity,
        })),
      },
      channel: 'push',
      deduplicationKey: `CART_ABANDONED_${userId}`,
      priority: 40,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Expire after 7 days
    });

    logger.info('CART_ABANDONED notification sent', { userId });
  } catch (error) {
    logger.error('Failed to handle CART_ABANDONED event', {
      error: error.message,
      userId,
    });
  }
}

/**
 * Handle PRICE_CHANGED event (behavioral notification)
 */
export async function handlePriceChanged(productId, oldPrice, newPrice) {
  try {
    const product = await Product.findById(productId);
    if (!product) {
      return;
    }

    // Only notify if price dropped (behavioral notification)
    if (newPrice < oldPrice) {
      // TODO: Get users who have this product in wishlist or viewed it
      // For now, we'll just log it
      logger.info('Price dropped - notification opportunity', {
        productId: product._id.toString(),
        oldPrice,
        newPrice,
        discount: oldPrice - newPrice,
      });

      // In a full implementation, you would:
      // 1. Query users who have this product in wishlist
      // 2. Query users who viewed but didn't purchase
      // 3. Send personalized notifications to each user
    }
  } catch (error) {
    logger.error('Failed to handle PRICE_CHANGED event', {
      error: error.message,
      productId,
    });
  }
}

/**
 * Handle LOW_STOCK event (merchant alert)
 */
export async function handleLowStock(productId, currentStock, threshold = 10) {
  try {
    const product = await Product.findById(productId).populate('merchant');

    if (!product || !product.merchant) {
      return;
    }

    if (currentStock <= threshold) {
      await notificationService.createNotification({
        type: 'LOW_STOCK',
        recipientType: 'merchant',
        recipientId: product.merchant.clerkId || product.merchant._id,
        title: 'Low Stock Alert',
        body: `Your product "${product.name}" is running low. Only ${currentStock} left in stock`,
        deepLink: `/merchant/products/${product._id}`,
        metadata: {
          productId: product._id.toString(),
          productName: product.name,
          currentStock,
          threshold,
        },
        channel: 'push',
        merchantId: product.merchant._id,
        deduplicationKey: `LOW_STOCK_${product._id}_${currentStock}`,
        priority: 60,
      });

      logger.info('LOW_STOCK notification sent', {
        productId: product._id.toString(),
        currentStock,
        threshold,
      });
    }
  } catch (error) {
    logger.error('Failed to handle LOW_STOCK event', {
      error: error.message,
      productId,
      currentStock,
    });
  }
}

/**
 * Handle BACK_IN_STOCK event (behavioral notification)
 */
export async function handleBackInStock(productId, currentStock) {
  try {
    const product = await Product.findById(productId);
    if (!product) {
      return;
    }

    // TODO: Get users who have this product in wishlist when it was out of stock
    // For now, we'll just log it
    logger.info('Product back in stock - notification opportunity', {
      productId: product._id.toString(),
      currentStock,
      productName: product.name,
    });

    // In a full implementation, you would:
    // 1. Query users who added this product to wishlist when stock was 0
    // 2. Send notifications to those users
    // 3. Mark as handled to prevent duplicate notifications
  } catch (error) {
    logger.error('Failed to handle BACK_IN_STOCK event', {
      error: error.message,
      productId,
    });
  }
}

/**
 * Handle REFUND_PROCESSED event
 */
export async function handleRefundProcessed(orderId, refundAmount) {
  try {
    const order = await Order.findById(orderId).populate('user');

    if (!order) {
      return;
    }

    await notificationService.createNotification({
      type: 'REFUND_PROCESSED',
      recipientType: 'user',
      recipientId: order.user.clerkId || order.user._id,
      title: 'Refund Processed',
      body: `Your refund of ${refundAmount} SDG for order #${order.orderNumber} has been processed`,
      deepLink: `/orders/${order._id}`,
      metadata: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        refundAmount,
      },
      channel: 'push',
      deduplicationKey: `REFUND_PROCESSED_${order._id}`,
      priority: 75,
    });

    logger.info('REFUND_PROCESSED notification sent', {
      orderId: order._id.toString(),
      refundAmount,
    });
  } catch (error) {
    logger.error('Failed to handle REFUND_PROCESSED event', {
      error: error.message,
      orderId,
    });
  }
}

/**
 * Create marketing notification (NEW_ARRIVALS, FLASH_SALE, etc.)
 */
export async function createMarketingNotification(type, data) {
  try {
    const {
      title,
      body,
      deepLink,
      metadata = {},
      targetRecipients = null, // null = broadcast, array = specific users, object = segmented
    } = data;

    if (targetRecipients === null) {
      // Broadcast to all users
      return await notificationService.broadcastToUsers({
        type,
        title,
        body,
        deepLink,
        metadata,
        channel: 'push',
        priority: type === 'FLASH_SALE' ? 45 : 20,
      });
    } else if (Array.isArray(targetRecipients)) {
      // Send to specific users
      return await notificationService.batchCreateNotifications(
        {
          type,
          title,
          body,
          deepLink,
          metadata,
          channel: 'push',
          priority: type === 'FLASH_SALE' ? 45 : 20,
        },
        targetRecipients,
        'user'
      );
    } else if (typeof targetRecipients === 'object' && targetRecipients.segment) {
      // Segmented targeting
      return await notificationService.sendToSegmentedUsers(
        {
          type,
          title,
          body,
          deepLink,
          metadata,
          channel: 'push',
          priority: type === 'FLASH_SALE' ? 45 : 20,
        },
        targetRecipients.segment
      );
    }
  } catch (error) {
    logger.error('Failed to create marketing notification', {
      error: error.message,
      type,
      data,
    });
    throw error;
  }
}
