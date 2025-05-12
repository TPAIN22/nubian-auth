import Cart from '../models/carts.model.js';

export const getCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const cart = await Cart.findOne({ user: userId }).populate('products.product');

        if (!cart) {
            return res.status(404).json({ message: 'No cart found for this user' });
        }

        res.status(200).json(cart);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const createCart = async (req, res) => {
    try {
        const userId = req.user.id;

        // تأكد من أن السلة غير موجودة مسبقًا
        const existingCart = await Cart.findOne({ user: userId });
        if (existingCart) {
            return res.status(400).json({ message: 'Cart already exists for this user' });
        }

        // إنشاء السلة الجديدة
        const cart = await Cart.create({
            user: userId,
            products: req.body.products,
            totalQuantity: req.body.totalQuantity,
            totalPrice: req.body.totalPrice,
        });

        res.status(201).json(cart);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const updateCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId, quantity } = req.body;

        // العثور على السلة الخاصة بالمستخدم
        const cart = await Cart.findOne({ user: userId });

        if (!cart) {
            return res.status(404).json({ message: 'No cart found for this user' });
        }

        // التحقق إذا كان المنتج موجودًا بالفعل في السلة
        const productIndex = cart.products.findIndex(p => p.product.toString() === productId);

        if (productIndex !== -1) {
            // إذا كان المنتج موجودًا في السلة
            if (quantity === 0) {
                // إذا كانت الكمية 0، قم بحذف المنتج
                cart.products.splice(productIndex, 1);
            } else {
                // إذا كانت الكمية أكبر من 0، قم بتقليص الكمية
                cart.products[productIndex].quantity = Math.max(1, cart.products[productIndex].quantity - quantity);
            }
        } else {
            return res.status(404).json({ message: 'Product not found in cart' });
        }

        // تحديث المجموع الكلي
        cart.totalQuantity = cart.products.reduce((acc, item) => acc + item.quantity, 0);
        cart.totalPrice = cart.products.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);

        await cart.save();

        res.status(200).json(cart);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
export const deleteCart = async (req, res) => {
    try {
        const userId = req.user.id;
        await Cart.findOneAndDelete({ user: userId });
        res.status(200).json({ message: 'Cart deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
