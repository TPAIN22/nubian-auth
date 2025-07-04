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

        const order = await Order.findByIdAndUpdate(id, updateData, { new: true })
            .populate({
                path: 'products.product',
                select: 'name price images category description stock'
            })
            .populate('user', 'name email');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
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
            return res.status(404).json({ message: 'User not found' });
        }

        const orders = await Order.find({ user: user._id })
            .populate({
                path: 'products.product',
                select: 'name price images category description stock createdAt'
            })
            .populate('user', 'name email phoneNumber')
            .sort({ orderDate: -1 });

        // تحسين البيانات المرجعة لتتضمن معلومات مفصلة
        const enhancedOrders = orders.map(order => ({
            ...order.toObject(),
            productsCount: order.products.length,
            productsDetails: order.products.map(item => ({
                productId: item.product?._id || null,
                name: item.product?.name || '',
                price: item.product?.price || 0,
                images: item.product?.images || [],
                category: item.product?.category || '',
                description: item.product?.description || '',
                stock: item.product?.stock || 0,
                quantity: item.quantity,
                totalPrice: (item.product?.price || 0) * item.quantity
            }))
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
        const lastNumber = parseInt(lastOrder.orderNumber.split('-')[1]);
        nextOrderNumber = lastNumber + 1;
    }
    const formattedOrderNumber = `ORD-${String(nextOrderNumber).padStart(4, '0')}`;
    try {
        const user = await User.findOne({ clerkId: userId });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        const cart = await Cart.findOne({ user: user._id }).populate('products.product');
        if (!cart || cart.products.length === 0) {
            return res.status(400).json({ message: 'Cart is empty or not found' });
        }
        const orderProducts = cart.products.map(item => ({
            product: item.product._id,
            quantity: item.quantity
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
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
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
                path: 'user',
                select: 'fullName emailAddress phoneNumber'
            })
            .populate({
                path: 'products.product',
                select: 'name price images category description stock createdAt'
            })
            .sort({ orderDate: -1 });

        // تحسين البيانات المرجعة للأدمن
        const enhancedOrders = orders.map(order => ({
            ...order.toObject(),
            productsCount: order.products.length,
            customerInfo: {
                name: order.user?.fullName || 'غير محدد',
                email: order.user?.emailAddress || 'غير محدد',
                phone: order.phoneNumber
            },
            productsDetails: order.products.map(item => ({
                productId: item.product?._id || null,
                name: item.product?.name || '',
                price: item.product?.price || 0,
                images: item.product?.images || [],
                category: item.product?.category || '',
                description: item.product?.description || '',
                stock: item.product?.stock || 0,
                quantity: item.quantity,
                totalPrice: (item.product?.price || 0) * item.quantity
            }))
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
            return res.status(404).json({ message: 'User not found' });
        }

        const order = await Order.findById(req.params.id)
            .populate('user', 'name email phoneNumber')
            .populate({
                path: 'products.product',
                select: 'name price images category description stock createdAt updatedAt'
            });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // التأكد من أن المستخدم يملك هذا الطلب
        if (order.user._id.toString() !== user._id.toString()) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // تحسين البيانات المرجعة
        const enhancedOrder = {
            ...order.toObject(),
            productsCount: order.products.length,
            productsDetails: order.products.map(item => ({
                productId: item.product?._id || null,
                name: item.product?.name || '',
                price: item.product?.price || 0,
                images: item.product?.images || [],
                category: item.product?.category || '',
                description: item.product?.description || '',
                stock: item.product?.stock || 0,
                quantity: item.quantity,
                totalPrice: (item.product?.price || 0) * item.quantity,
                isAvailable: (item.product?.stock || 0) > 0
            })),
            orderSummary: {
                subtotal: order.totalAmount,
                tax: 0, // يمكن إضافة حساب الضريبة هنا
                shipping: 0, // يمكن إضافة رسوم الشحن هنا
                total: order.totalAmount
            }
        };


        res.status(200).json(enhancedOrder);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// دالة إضافية للحصول على إحصائيات الطلبات
export const getOrderStats = async (req, res) => {
    try {
        const stats = await Order.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$totalAmount' }
                }
            }
        ]);

        const totalOrders = await Order.countDocuments();
        const totalRevenue = await Order.aggregate([
            { $match: { status: { $ne: 'cancelled' } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        res.status(200).json({
            statusStats: stats,
            totalOrders,
            totalRevenue: totalRevenue[0]?.total || 0
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};