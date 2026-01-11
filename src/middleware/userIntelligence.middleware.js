// middleware/userIntelligence.middleware.js
import User from '../models/user.model.js';
import { getAuth } from '@clerk/express';
import logger from '../lib/logger.js';

/**
 * Middleware to record product views
 * Call this when a user views a product details page
 */
export const recordProductView = async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      return next(); // Skip if user not authenticated
    }

    const { productId } = req.params;
    if (!productId) {
      return next(); // Skip if no product ID
    }

    // Find user by clerkId
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return next(); // Skip if user not found
    }

    // Update lastActive
    user.lastActive = new Date();

    // Find existing view entry
    const existingViewIndex = user.viewedProducts.findIndex(
      (vp) => vp.product.toString() === productId
    );

    if (existingViewIndex >= 0) {
      // Increment view count and update timestamp
      user.viewedProducts[existingViewIndex].viewCount += 1;
      user.viewedProducts[existingViewIndex].viewedAt = new Date();
    } else {
      // Add new view entry
      user.viewedProducts.push({
        product: productId,
        viewedAt: new Date(),
        viewCount: 1,
      });
    }

    // Keep only last 500 viewed products (limit array size)
    if (user.viewedProducts.length > 500) {
      user.viewedProducts = user.viewedProducts
        .sort((a, b) => b.viewedAt - a.viewedAt)
        .slice(0, 500);
    }

    await user.save();

    // Fire and forget - don't block request
    next();
  } catch (error) {
    // Log error but don't block request
    logger.error('Error recording product view', {
      error: error.message,
      productId: req.params.productId,
    });
    next();
  }
};

/**
 * Middleware to record product clicks
 * Call this when a user clicks on a product card/tile
 */
export const recordProductClick = async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      return next();
    }

    const { productId } = req.params;
    if (!productId) {
      return next();
    }

    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return next();
    }

    user.lastActive = new Date();

    const existingClickIndex = user.clickedProducts.findIndex(
      (cp) => cp.product.toString() === productId
    );

    if (existingClickIndex >= 0) {
      user.clickedProducts[existingClickIndex].clickCount += 1;
      user.clickedProducts[existingClickIndex].clickedAt = new Date();
    } else {
      user.clickedProducts.push({
        product: productId,
        clickedAt: new Date(),
        clickCount: 1,
      });
    }

    // Keep only last 300 clicked products
    if (user.clickedProducts.length > 300) {
      user.clickedProducts = user.clickedProducts
        .sort((a, b) => b.clickedAt - a.clickedAt)
        .slice(0, 300);
    }

    await user.save();
    next();
  } catch (error) {
    logger.error('Error recording product click', {
      error: error.message,
      productId: req.params.productId,
    });
    next();
  }
};

/**
 * Middleware to record cart events
 * Call this when a user adds/removes items from cart
 */
export const recordCartEvent = async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      return next();
    }

    const { productId } = req.body;
    if (!productId) {
      return next();
    }

    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return next();
    }

    user.lastActive = new Date();

    const eventType = req.method === 'POST' || req.method === 'PUT' ? 'add' : 'remove';

    // Add cart event
    user.cartEvents.push({
      product: productId,
      eventType,
      timestamp: new Date(),
    });

    // Keep only last 200 cart events
    if (user.cartEvents.length > 200) {
      user.cartEvents = user.cartEvents
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 200);
    }

    await user.save();
    next();
  } catch (error) {
    logger.error('Error recording cart event', {
      error: error.message,
    });
    next();
  }
};

/**
 * Middleware to record search keywords
 * Call this when a user performs a search
 */
export const recordSearch = async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      return next();
    }

    const { q, query, keyword, search } = req.query;
    const searchKeyword = q || query || keyword || search;
    if (!searchKeyword || typeof searchKeyword !== 'string') {
      return next();
    }

    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return next();
    }

    user.lastActive = new Date();

    const trimmedKeyword = searchKeyword.trim().toLowerCase();
    if (trimmedKeyword.length === 0) {
      return next();
    }

    const existingSearchIndex = user.searchKeywords.findIndex(
      (sk) => sk.keyword === trimmedKeyword
    );

    if (existingSearchIndex >= 0) {
      user.searchKeywords[existingSearchIndex].searchCount += 1;
      user.searchKeywords[existingSearchIndex].searchedAt = new Date();
    } else {
      user.searchKeywords.push({
        keyword: trimmedKeyword,
        searchedAt: new Date(),
        searchCount: 1,
      });
    }

    // Keep only last 100 search keywords
    if (user.searchKeywords.length > 100) {
      user.searchKeywords = user.searchKeywords
        .sort((a, b) => b.searchedAt - a.searchedAt)
        .slice(0, 100);
    }

    await user.save();
    next();
  } catch (error) {
    logger.error('Error recording search', {
      error: error.message,
    });
    next();
  }
};

/**
 * Middleware to record category opens
 * Call this when a user opens a category page
 */
export const recordCategoryOpen = async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      return next();
    }

    const { categoryId } = req.params;
    if (!categoryId) {
      return next();
    }

    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return next();
    }

    user.lastActive = new Date();
    await user.save();
    next();
  } catch (error) {
    logger.error('Error recording category open', {
      error: error.message,
    });
    next();
  }
};

/**
 * Helper function to update user preferences from purchase history
 * Call this after order completion
 */
export const updateUserPreferencesFromOrder = async (userId, order) => {
  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return;
    }

    // Update purchased categories
    if (order.products && order.products.length > 0) {
      // This will be populated in the controller
      // For now, we'll update in the order controller
    }

    user.lastActive = new Date();
    await user.save();
  } catch (error) {
    logger.error('Error updating user preferences from order', {
      error: error.message,
      userId,
    });
  }
};
