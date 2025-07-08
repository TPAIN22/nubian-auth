import Wishlist from '../models/wishlist.model.js';
import Product from '../models/products.model.js';
import { getAuth } from '@clerk/express';

export const getWishlist = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const wishlist = await Wishlist.findOne({ user: userId }).populate('products');
    if (!wishlist) return res.status(200).json([]);
    res.status(200).json(wishlist.products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const addToWishlist = async (req, res) => {
  const { userId } = getAuth(req);
  const { productId } = req.params;
  try {
    let wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      wishlist = await Wishlist.create({ user: userId, products: [productId] });
    } else if (!wishlist.products.includes(productId)) {
      wishlist.products.push(productId);
      await wishlist.save();
    }
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const removeFromWishlist = async (req, res) => {
  const { userId } = getAuth(req);
  const { productId } = req.params;
  try {
    const wishlist = await Wishlist.findOne({ user: userId });
    if (wishlist) {
      wishlist.products = wishlist.products.filter(
        (id) => id.toString() !== productId
      );
      await wishlist.save();
    }
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 