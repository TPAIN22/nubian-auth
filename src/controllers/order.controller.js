import Order from '../models/orders.model.js';
import Cart from '../models/carts.model.js';

export const updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;

        const allowedStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid status value' });
        }

        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        );

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        res.status(200).json(order);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getUserOrders = async (req, res) => {
    try {
        const userId = req.user.id;

        const orders = await Order.find({ user: userId })
            .populate('products.product') 
            .sort({ orderDate: -1 });

        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const createOrder = async (req, res) => {
    try {
        const userId = req.user.id;

        // الحصول على السلة الخاصة بالمستخدم
        const cart = await Cart.findOne({ user: userId }).populate('products.product');

        if (!cart || cart.products.length === 0) {
            return res.status(400).json({ message: 'Cart is empty or not found' });
        }

        // تحويل المنتجات في السلة إلى المنتجات في الطلب
        const orderProducts = cart.products.map(item => ({
            product: item.product._id,
            quantity: item.quantity
        }));

        // إنشاء الطلب الجديد
        const order = await Order.create({
            user: userId,
            products: orderProducts,
            totalAmount: req.body.totalAmount,
            deliveryAddress: req.body.deliveryAddress,
            paymentMethod: req.body.paymentMethod,
        });

        // حذف السلة بعد إنشاء الطلب
        await Cart.findOneAndDelete({ user: userId });

        res.status(201).json(order);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
export const getOrders = async (req, res) => {
    try {
        const orders = await Order.find()
            .populate('user')
            .populate('products.product')
            .sort({ orderDate: -1 });

        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
export const getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('user')
            .populate('products.product');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        res.status(200).json(order);
    } catch (error) {   
        res.status(500).json({ message: error.message });
    }
};



