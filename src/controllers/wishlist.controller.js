import User from '../models/user.model.js';
import Wishlist from '../models/wishlist.model.js';
import { getAuth } from '@clerk/express';

export const getWishlist = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(200).json([]);
    }

    const wishlist = await Wishlist.findOne({ user: user._id }).populate('products');
    if (!wishlist) {
      return res.status(200).json([]);
    }

    res.status(200).json(wishlist.products);
  } catch (error) {
    console.error('Error in getWishlist:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const addToWishlist = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ message: 'Product ID is required' });
    }

    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let wishlist = await Wishlist.findOne({ user: user._id });
    if (!wishlist) {
      wishlist = await Wishlist.create({ user: user._id, products: [productId] });
    } else if (!wishlist.products.includes(productId)) {
      wishlist.products.push(productId);
      await wishlist.save();
    }

    res.status(200).json({ success: true, message: 'Product added to wishlist' });
  } catch (error) {
    console.error('Error in addToWishlist:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ message: 'Product ID is required' });
    }

    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(200).json({ success: true, message: 'Product removed from wishlist' });
    }

    const wishlist = await Wishlist.findOne({ user: user._id });
    if (wishlist) {
      wishlist.products = wishlist.products.filter(
        (id) => id.toString() !== productId
      );
      await wishlist.save();
    }

    res.status(200).json({ success: true, message: 'Product removed from wishlist' });
  } catch (error) {
    console.error('Error in removeFromWishlist:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}; 