import Cart from "../models/carts.model.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";
import mongoose from "mongoose";

// دالة مساعدة لحساب إجماليات السلة وتحديث وقت التعديل
const calculateCartTotals = async (cart) => {
    // التأكد من جلب تفاصيل المنتج قبل الحساب
    await cart.populate({
        path: "products.product",
        select: "name price image", // تحديد الحقول المطلوبة فقط
        model: 'Product' // تحديد الموديل بشكل صريح
    });

    cart.totalQuantity = cart.products.reduce((acc, item) => acc + item.quantity, 0);
    cart.totalPrice = cart.products.reduce((acc, item) => {
        // التحقق من وجود المنتج ووجود السعر لضمان عدم حدوث أخطاء
        if (item.product && typeof item.product.price === 'number') {
            return acc + item.product.price * item.quantity;
        }
        // تسجيل تحذير إذا كان المنتج مفقودًا أو سعره غير صالح
        console.warn(`Warning: Product ID: ${item.product?._id} has no price or invalid price. Skipping in total calculation.`);
        return acc;
    }, 0);
    cart.updatedAt = Date.now(); // تحديث وقت آخر تعديل
};

// ---

// 🛒 جلب السلة (`getCart`)
export const getCart = async (req, res) => {
    const { userId } = getAuth(req); // الحصول على معرف المستخدم من Clerk

    try {
        const user = await User.findOne({ clerkId: userId }); // البحث عن المستخدم في قاعدة البيانات الخاصة بنا

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // البحث عن سلة التسوق الخاصة بالمستخدم وجلب تفاصيل المنتجات
        const cart = await Cart.findOne({ user: user._id }).populate({
            path: "products.product",
            select: "name price image", // جلب الحقول الأساسية للمنتج فقط لتحسين الأداء
            model: 'Product'
        });

        if (!cart) {
            // إذا لم يتم العثور على سلة، نرجع سلة فارغة (status 200) بدلاً من 404
            return res.status(200).json({ products: [], totalQuantity: 0, totalPrice: 0 });
        }

        res.status(200).json(cart);
    } catch (error) {
        console.error("Error in getCart:", error); // تسجيل الخطأ في السجل الخاص بالخادم
        res.status(500).json({
            message: "An error occurred while fetching cart.",
            // عرض تفاصيل الخطأ في وضع التطوير فقط
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ---

// ➕ إضافة منتج للسلة (`addToCart`)
export const addToCart = async (req, res) => {
    const { userId } = getAuth(req);

    try {
        // الحصول على بيانات المنتج من الجسم الطلب مع قيم افتراضية
        const { productId, quantity: incomingQuantity = 1, size = '' } = req.body;

        // التحقق من صحة المدخلات الأساسية
        if (!productId) {
            return res.status(400).json({ message: "Product ID is required" });
        }
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({ message: "Invalid product ID format" });
        }
        if (incomingQuantity <= 0) {
            return res.status(400).json({ message: "Quantity must be greater than zero." });
        }

        const user = await User.findOne({ clerkId: userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // التحقق من وجود المنتج في قاعدة بيانات المنتجات
        const ProductModel = mongoose.model("Product");
        const productExists = await ProductModel.findById(productId);
        if (!productExists) {
            return res.status(404).json({ message: "Product not found." });
        }

        // البحث عن السلة أو إنشاؤها إذا لم تكن موجودة
        let cart = await Cart.findOneAndUpdate(
            { user: user._id },
            {
                // تهيئة الحقول عند إنشاء سلة جديدة
                $setOnInsert: { user: user._id, products: [], totalQuantity: 0, totalPrice: 0 },
            },
            { upsert: true, new: true, runValidators: true } // upsert: ينشئ إذا لم يجد، new: يعيد الوثيقة الجديدة
        );

        // البحث عن المنتج المحدد (بمعرف المنتج والحجم) داخل السلة
        const productIndex = cart.products.findIndex(
            (p) => p.product && p.product.toString() === productId && p.size === size
        );

        if (productIndex !== -1) {
            // إذا كان المنتج موجودًا، نزيد الكمية
            cart.products[productIndex].quantity += incomingQuantity;
        } else {
            // إذا لم يكن المنتج موجودًا، نضيفه كعنصر جديد
            cart.products.push({ product: new mongoose.Types.ObjectId(productId), quantity: incomingQuantity, size });
        }

        // إعادة حساب الإجماليات وتحديث وقت التعديل
        await calculateCartTotals(cart);
        await cart.save(); // حفظ التغييرات في قاعدة البيانات

        res.status(200).json(cart);

    } catch (error) {
        console.error("Error in addToCart:", error);
        res.status(500).json({
            message: "An error occurred while adding to cart.",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ---

// 🔄 تحديث السلة (`updateCart`)
export const updateCart = async (req, res) => {
    const { userId } = getAuth(req);

    try {
        const user = await User.findOne({ clerkId: userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // الحصول على معرف المنتج، الكمية الجديدة، والحجم
        const { productId, quantity, size = '' } = req.body;

        // التحقق من صحة المدخلات
        if (!productId || typeof quantity === 'undefined') {
            return res.status(400).json({ message: "Product ID and quantity are required." });
        }
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({ message: "Invalid product ID format." });
        }

        let cart = await Cart.findOne({ user: user._id });
        if (!cart) {
            return res.status(404).json({ message: "No cart found for this user." });
        }

        // البحث عن المنتج المحدد (بمعرف المنتج والحجم) داخل السلة
        const productIndex = cart.products.findIndex(
            (p) => p.product && p.product.toString() === productId && p.size === size
        );

        if (productIndex !== -1) {
            if (quantity <= 0) {
                // إذا كانت الكمية المطلوبة صفر أو أقل، يتم إزالة المنتج من السلة
                cart.products.splice(productIndex, 1);
            } else {
                // تحديث الكمية مباشرة بالقيمة الجديدة
                cart.products[productIndex].quantity = quantity;
            }
        } else {
            // إذا لم يتم العثور على المنتج المحدد في السلة
            return res.status(404).json({ message: "Product with specified ID and size not found in cart." });
        }

        // إعادة حساب الإجماليات وتحديث وقت التعديل بعد التعديل
        await calculateCartTotals(cart);
        await cart.save(); // حفظ التغييرات في قاعدة البيانات

        res.status(200).json(cart);
    } catch (error) {
        console.error("Error in updateCart:", error);
        res.status(500).json({
            message: "An error occurred while updating cart.",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ---

// ❌ حذف السلة بالكامل (`deleteCart`)
export const deleteCart = async (req, res) => {
    const { userId } = getAuth(req);

    try {
        const user = await User.findOne({ clerkId: userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // البحث عن السلة وحذفها
        const result = await Cart.findOneAndDelete({ user: user._id });

        if (!result) {
            // إذا لم يتم العثور على سلة للحذف
            return res.status(404).json({ message: "No cart found to delete for this user." });
        }

        res.status(200).json({ message: "Cart deleted successfully." });
    } catch (error) {
        console.error("Error in deleteCart:", error);
        res.status(500).json({
            message: "An error occurred while deleting cart.",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};