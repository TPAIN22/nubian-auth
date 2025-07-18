import User from '../models/user.model.js';
import Wishlist from '../models/wishlist.model.js';
import { getAuth } from '@clerk/express';

export const getWishlist = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) return res.status(200).json([]);
    const wishlist = await Wishlist.findOne({ user: user._id }).populate('products');
    if (!wishlist) return res.status(200).json([]);
    res.status(200).json(wishlist.products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const addToWishlist = async (req, res) => {
  const { userId } = getAuth(req);
  const { productId } = req.params;
  const user = await User.findOne({ clerkId: userId });
  try {
    let wishlist = await Wishlist.findOne({ user: user._id });
    if (!wishlist) {
      wishlist = await Wishlist.create({ user:user._id , products: [productId] });
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
    const user = await User.findOne({ clerkId: userId });
    if (!user) return res.status(200).json({ success: true });
    const wishlist = await Wishlist.findOne({ user: user._id });
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