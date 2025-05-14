import Cart from '../models/carts.model.js';
import { getAuth } from "@clerk/express";
import User from '../models/user.model.js';
import mongoose from 'mongoose'; // أضفنا mongoose لاستخدام Types.ObjectId

// 🛒 جلب السلة
export const getCart = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const user = await User.findOne({ clerkId: userId });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const cart = await Cart.findOne({ user: user._id }).populate('products.product');

    if (!cart) {
      return res.status(404).json({ message: 'No cart found for this user' });
    }

    res.status(200).json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log(error, 'error in getCart');
  }
};

// ➕ إضافة منتج للسلة
export const addToCart = async (req, res) => {
  const { userId } = getAuth(req);
  
  try {
    const { productId, quantity } = req.body;
    
    if (!productId) {
      return res.status(400).json({ message: 'Product ID is required' });
    }
    
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }
    
    const user = await User.findOne({ clerkId: userId });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // تحقق من وجود المنتج في قاعدة البيانات
    const productExists = await mongoose.model('Product').findById(productId);
    
    if (!productExists) {
      return res.status(404).json({ message: 'Product not found' });
    }

    let cart = await Cart.findOne({ user: user._id });

    if (!cart) {
      cart = new Cart({
        user: user._id,
        products: [{ product: productId, quantity }],
        totalQuantity: quantity,
        totalPrice: 0,
      });
    } else {
      const productIndex = cart.products.findIndex(
        (p) => p.product && p.product.toString() === productId
      );

      if (productIndex !== -1) {
        cart.products[productIndex].quantity += quantity;
      } else {
        cart.products.push({ product: productId, quantity });
      }

      cart.totalQuantity = cart.products.reduce(
        (acc, item) => acc + item.quantity,
        0
      );
    }
    await cart.populate({
      path: "products.product",
      select: "price name image" 
    });

    cart.totalPrice = cart.products.reduce((acc, item) => {
      if (item.product && item.product.price) {
        return acc + item.product.price * item.quantity;
      } else {
        console.warn(`Product missing or has no price: ${item.product?._id}`);
        return acc;
      }
    }, 0);    
   await cart.save();
    res.status(200).json(cart);
    
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log(error, "error in addToCart");
  }
};

// 🔄 تحديث السلة
export const updateCart = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    // أولاً نجد المستخدم باستخدام clerkId
    const user = await User.findOne({ clerkId: userId });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const { productId, quantity } = req.body;

    const cart = await Cart.findOne({ user: user._id });

    if (!cart) {
      return res.status(404).json({ message: 'No cart found for this user' });
    }

    const productIndex = cart.products.findIndex(
      p => p.product.toString() === productId
    );

    if (productIndex !== -1) {
      if (quantity === 0) {
        cart.products.splice(productIndex, 1);
      } else {
        cart.products[productIndex].quantity = Math.max(1, cart.products[productIndex].quantity + quantity);
      }
    } else {
      return res.status(404).json({ message: 'Product not found in cart' });
    }

    await cart.populate("products.product");

    cart.totalQuantity = cart.products.reduce((acc, item) => acc + item.quantity, 0);
    cart.totalPrice = cart.products.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);

    await cart.save();

    res.status(200).json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log(error, "error in updateCart");
  }
};

// ❌ حذف السلة بالكامل
export const deleteCart = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    // أولاً نجد المستخدم باستخدام clerkId
    const user = await User.findOne({ clerkId: userId });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    await Cart.findOneAndDelete({ user: user._id });
    res.status(200).json({ message: 'Cart deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log(error, "error in deleteCart");
  }
};