import Order from '../models/orders.model.js';
import Cart from '../models/carts.model.js';
import { getAuth } from '@clerk/express';
import User from '../models/user.model.js';

export const updateOrderStatus = async (req, res) => {
  try {
    const { status, paymentStatus } = req.body;
    const { id } = req.params;

    const allowedStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    const allowedPaymentStatus = ['pending', 'paid', 'failed'];

    const updateData = {};

    if (status !== undefined) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status value' });
      }
      updateData.status = status;
    }

    if (paymentStatus !== undefined) {
      if (!allowedPaymentStatus.includes(paymentStatus)) {
        return res.status(400).json({ message: 'Invalid payment status value' });
      }
      updateData.paymentStatus = paymentStatus;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No valid data to update' });
    }

    const order = await Order.findByIdAndUpdate(id, updateData, { new: true });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.status(200).json(order);
  } catch (error) {
    console.error("error in updateOrderStatus", error);
    res.status(500).json({ message: error.message });
  }
};


export const getUserOrders = async (req, res) => {
    const { userId } = getAuth(req);
    try {
        const user = await User.findOne({ clerkId: userId });
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const orders = await Order.find({ user: user._id })
            .populate('products.product') 
            .sort({ orderDate: -1 });

        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ message: error.message });
        console.log(error, "error in getUserOrders");
    }
};

export const createOrder = async (req, res) => {
    const { userId } = getAuth(req);
    let lastOrder = await Order.findOne().sort({ createdAt: -1 });
    if(!lastOrder){
        lastOrder = {orderNumber: "ORD-0001"};
    }
    let nextOrderNumber = 1;
    if (lastOrder && lastOrder.orderNumber) {
    const lastNumber = parseInt(lastOrder.orderNumber.split('-')[1]);
    nextOrderNumber = lastNumber + 1;
}

// أنشئ رقم طلب جديد بصيغة مثل: ORD-0001
    const formattedOrderNumber = `ORD-${String(nextOrderNumber).padStart(4, '0')}`;
    try {
        const user = await User.findOne({ clerkId: userId });
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // الحصول على السلة الخاصة بالمستخدم
        const cart = await Cart.findOne({ user: user._id }).populate('products.product');

        if (!cart || cart.products.length === 0) {
            return res.status(400).json({ message: 'Cart is empty or not found' });
        }

        // تحويل المنتجات في السلة إلى المنتجات في الطلب
        const orderProducts = cart.products.map(item => ({
            product: item.product._id,
            quantity: item.quantity,
            name: item.product.name,
            category: item.product.category,
        }));
        const totalAmount = cart.products.reduce((sum, item) => {
            return sum + item.product.price * item.quantity;
          }, 0);
          

        // إنشاء الطلب الجديد
        const order = await Order.create({
            user: user._id,
            products: orderProducts,
            totalAmount,
            paymentMethod: req.body.paymentMethod,
            orderNumber: formattedOrderNumber,
            phoneNumber: req.body.deliveryAddress.phone,
            city: req.body.deliveryAddress.city,
            address: req.body.deliveryAddress.address
        });

        await Cart.findOneAndDelete({ user: user._id });
        if(!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.status(201).json(order);
    } catch (error) {
        res.status(500).json({ message: error.message });
        console.log(error, "error in createOrder");
    }
};

export const getOrders = async (req, res) => {
    try {
        const orders = await Order.find()
            .populate('user')
            .populate('products.product')
            .sort({ orderDate: -1 });
        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ message: error.message });
        console.log(error, "error in getOrders");
    }
};

export const getOrderById = async (req, res) => {
    const { userId } = getAuth(req);
    try {
        const user = await User.findOne({ clerkId: userId });
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const order = await Order.findById(req.params.id)
            .populate('user')
            .populate('products.product');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        res.status(200).json(order);
    } catch (error) {   
        res.status(500).json({ message: error.message });
        console.log(error, "error in getOrderById");
    }
};



