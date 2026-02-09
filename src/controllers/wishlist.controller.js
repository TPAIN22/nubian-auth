import User from '../models/user.model.js';
import Wishlist from '../models/wishlist.model.js';
import { getAuth } from '@clerk/express';
import logger from '../lib/logger.js';

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

    let products = wishlist.products || [];

    // Apply currency conversion if currencyCode is provided
    const currencyCode = req.currencyCode;
    if (currencyCode && currencyCode.toUpperCase() !== 'USD') {
      try {
        const upperCode = currencyCode.toUpperCase();
        
        const CurrencyModel = (await import('../models/currency.model.js')).default;
        const { getLatestRate } = await import('../services/fx.service.js');
        const { convertProductPrices } = await import('../services/currency.service.js');

        const [currencyConfig, rateInfo] = await Promise.all([
             CurrencyModel.findOne({ code: upperCode }).lean(),
             getLatestRate(upperCode)
        ]);
        
        const currencyContext = {
            config: currencyConfig,
            rate: rateInfo
        };

        products = await Promise.all(
          products.map(product => convertProductPrices(product.toObject ? product.toObject() : product, currencyCode, currencyContext))
        );
      } catch (error) {
        logger.warn('Currency conversion failed for wishlist', { error: error.message });
      }
    }

    res.status(200).json(products);
  } catch (error) {
    logger.error('Error in getWishlist', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
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
    logger.error('Error in addToWishlist', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
      productId: req.params.productId,
    });
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
    logger.error('Error in removeFromWishlist', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
      productId: req.params.productId,
    });
    res.status(500).json({ message: 'Internal server error' });
  }
}; 