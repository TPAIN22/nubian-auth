import Order from '../models/orders.model.js';
import Cart from '../models/carts.model.js';
import { getAuth } from '@clerk/express';
import User from '../models/user.model.js';
import { sendOrderEmail } from '../lib/mail.js';
import Coupon from '../models/coupon.model.js';

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
        let totalAmount = cart.products.reduce((sum, item) => {
            return sum + item.product.price * item.quantity;
        }, 0);
        let discountAmount = 0;
        let couponId = null;
        // دعم الكوبون
        if (req.body.couponCode) {
            const coupon = await Coupon.findOne({ code: req.body.couponCode, isActive: true });
            if (!coupon) {
                return res.status(400).json({ message: 'Invalid or inactive coupon code' });
            }
            // تحقق من تاريخ الانتهاء
            if (coupon.expiresAt < new Date()) {
                return res.status(400).json({ message: 'Coupon has expired' });
            }
            // تحقق من حدود الاستخدام الكلي
            if (coupon.usageLimit > 0 && coupon.usedBy.length >= coupon.usageLimit) {
                return res.status(400).json({ message: 'Coupon usage limit reached' });
            }
            // تحقق من حدود الاستخدام لكل مستخدم
            const userUsedCount = coupon.usedBy.filter(u => u.toString() === user._id.toString()).length;
            if (coupon.usageLimitPerUser > 0 && userUsedCount >= coupon.usageLimitPerUser) {
                return res.status(400).json({ message: 'You have already used this coupon the maximum allowed times' });
            }
            // حساب قيمة الخصم
            if (coupon.discountType === 'percentage') {
                discountAmount = totalAmount * (coupon.discountValue / 100);
            } else {
                discountAmount = coupon.discountValue;
            }
            // لا يتجاوز الخصم المجموع الكلي
            if (discountAmount > totalAmount) discountAmount = totalAmount;
            couponId = coupon._id;
            // تحديث الكوبون (إضافة المستخدم لقائمة المستخدمين الذين استخدموا الكوبون)
            coupon.usedBy.push(user._id);
            await coupon.save();
        }
        const finalAmount = totalAmount - discountAmount;
        // دعم هيكل العنوان الجديد من الواجهة الأمامية (city, area, street, building, ...)
        const delivery = req.body.deliveryAddress || {};
        const addressString = delivery.address
            || [delivery.area, delivery.street, delivery.building].filter(Boolean).join(', ')
            || '';
        // إنشاء الطلب الجديد
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
            address: addressString
        });
        await Cart.findOneAndDelete({ user: user._id });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        // إرسال الإيميل للمستخدم بعد إنشاء الطلب
        try {
            await sendOrderEmail({
                to: user.emailAddress || user.email, // دعم الحقلين
                userName: user.fullName || user.name || '',
                orderNumber: formattedOrderNumber,
                status: 'بانتظار التأكيد',
                totalAmount: finalAmount,
                products: cart.products.map(item => ({
                    name: item.product.name,
                    quantity: item.quantity,
                    price: item.product.price
                }))
            });
        } catch (mailErr) {
            console.error('فشل إرسال الإيميل:', mailErr);
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
            })),
            discountAmount: order.discountAmount,
            finalAmount: order.finalAmount,
            orderSummary: {
                subtotal: order.totalAmount,
                discount: order.discountAmount,
                total: order.finalAmount
            }
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
            discountAmount: order.discountAmount,
            finalAmount: order.finalAmount,
            orderSummary: {
                subtotal: order.totalAmount,
                discount: order.discountAmount,
                total: order.finalAmount
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