// controllers/cart.controller.js

import Cart from '../models/carts.model.js';
import Product from '../models/product.model.js';

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

export const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity } = req.body;

    let cart = await Cart.findOne({ user: userId });

    if (!cart) {
      cart = new Cart({
        user: userId,
        products: [{ product: productId, quantity }],
        totalQuantity: quantity,
        totalPrice: 0,
      });
    } else {
      const productIndex = cart.products.findIndex(p => p.product.toString() === productId);

      if (productIndex !== -1) {
        cart.products[productIndex].quantity += quantity;
      } else {
        cart.products.push({ product: productId, quantity });
      }

      cart.totalQuantity = cart.products.reduce((acc, item) => acc + item.quantity, 0);
    }

    await cart.populate("products.product");

    cart.totalPrice = cart.products.reduce((acc, item) => {
      return acc + (item.product.price * item.quantity);
    }, 0);

    await cart.save();

    res.status(200).json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity } = req.body;

    const cart = await Cart.findOne({ user: userId });

    if (!cart) {
      return res.status(404).json({ message: 'No cart found for this user' });
    }

    const productIndex = cart.products.findIndex(p => p.product.toString() === productId);

    if (productIndex !== -1) {
      if (quantity === 0) {
        cart.products.splice(productIndex, 1);
      } else {
        cart.products[productIndex].quantity = Math.max(1, cart.products[productIndex].quantity - quantity);
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
  }
};

export const deleteCart = async (req, res) => {
  try {
    const userId = req.user.id;
    await Cart.findOneAndDelete({ user: userId });
    res.status(200).json({ message: 'Cart deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
