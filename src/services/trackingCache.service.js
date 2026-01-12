// services/trackingCache.service.js
import logger from '../lib/logger.js';

/**
 * Real-time in-memory cache for trending/hot data
 * Updates based on user activity
 */
class TrackingCacheService {
  constructor() {
    // Hot products: views per minute
    this.hotProducts = new Map(); // productId -> { views: number, addToCart: number, purchases: number, lastUpdated: Date }
    
    // Trending categories: views per minute
    this.trendingCategories = new Map(); // categoryId -> { views: number, lastUpdated: Date }
    
    // Active stores: views per minute
    this.activeStores = new Map(); // storeId -> { views: number, lastUpdated: Date }
    
    // Cleanup interval: remove entries older than 1 hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000); // 1 hour
  }

  /**
   * Update cache based on event
   */
  updateCache(event, data) {
    try {
      const now = Date.now();
      
      switch (event) {
        case 'product_view':
        case 'product_click':
        case 'product_impression':
          if (data.productId) {
            const product = this.hotProducts.get(data.productId) || {
              views: 0,
              addToCart: 0,
              purchases: 0,
              lastUpdated: now,
            };
            product.views += 1;
            product.lastUpdated = now;
            this.hotProducts.set(data.productId, product);
          }
          break;

        case 'add_to_cart':
          if (data.productId) {
            const product = this.hotProducts.get(data.productId) || {
              views: 0,
              addToCart: 0,
              purchases: 0,
              lastUpdated: now,
            };
            product.addToCart += 1;
            product.lastUpdated = now;
            this.hotProducts.set(data.productId, product);
          }
          break;

        case 'purchase':
          if (data.productId) {
            const product = this.hotProducts.get(data.productId) || {
              views: 0,
              addToCart: 0,
              purchases: 0,
              lastUpdated: now,
            };
            product.purchases += 1;
            product.lastUpdated = now;
            this.hotProducts.set(data.productId, product);
          }
          break;

        case 'category_open':
          if (data.categoryId) {
            const category = this.trendingCategories.get(data.categoryId) || {
              views: 0,
              lastUpdated: now,
            };
            category.views += 1;
            category.lastUpdated = now;
            this.trendingCategories.set(data.categoryId, category);
          }
          break;

        case 'store_open':
          if (data.storeId) {
            const store = this.activeStores.get(data.storeId) || {
              views: 0,
              lastUpdated: now,
            };
            store.views += 1;
            store.lastUpdated = now;
            this.activeStores.set(data.storeId, store);
          }
          break;
      }
    } catch (error) {
      logger.error('Error updating tracking cache', { error: error.message });
    }
  }

  /**
   * Get hot products (sorted by views + addToCart + purchases)
   */
  getHotProducts(limit = 10) {
    const products = Array.from(this.hotProducts.entries())
      .map(([productId, data]) => ({
        productId,
        score: data.views * 0.5 + data.addToCart * 2 + data.purchases * 5,
        views: data.views,
        addToCart: data.addToCart,
        purchases: data.purchases,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return products;
  }

  /**
   * Get trending categories (sorted by views)
   */
  getTrendingCategories(limit = 10) {
    const categories = Array.from(this.trendingCategories.entries())
      .map(([categoryId, data]) => ({
        categoryId,
        views: data.views,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, limit);

    return categories;
  }

  /**
   * Get active stores (sorted by views)
   */
  getActiveStores(limit = 10) {
    const stores = Array.from(this.activeStores.entries())
      .map(([storeId, data]) => ({
        storeId,
        views: data.views,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, limit);

    return stores;
  }

  /**
   * Cleanup old entries (older than 1 hour)
   */
  cleanup() {
    try {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;

      // Cleanup hot products
      for (const [productId, data] of this.hotProducts.entries()) {
        if (data.lastUpdated < oneHourAgo) {
          this.hotProducts.delete(productId);
        }
      }

      // Cleanup trending categories
      for (const [categoryId, data] of this.trendingCategories.entries()) {
        if (data.lastUpdated < oneHourAgo) {
          this.trendingCategories.delete(categoryId);
        }
      }

      // Cleanup active stores
      for (const [storeId, data] of this.activeStores.entries()) {
        if (data.lastUpdated < oneHourAgo) {
          this.activeStores.delete(storeId);
        }
      }
    } catch (error) {
      logger.error('Error cleaning up tracking cache', { error: error.message });
    }
  }

  /**
   * Reset cache (useful for testing)
   */
  reset() {
    this.hotProducts.clear();
    this.trendingCategories.clear();
    this.activeStores.clear();
  }
}

// Singleton instance
const trackingCacheService = new TrackingCacheService();

/**
 * Update real-time cache
 */
export const updateRealTimeCache = (event, data) => {
  trackingCacheService.updateCache(event, data);
};

/**
 * Get hot products
 */
export const getHotProducts = (limit) => {
  return trackingCacheService.getHotProducts(limit);
};

/**
 * Get trending categories
 */
export const getTrendingCategories = (limit) => {
  return trackingCacheService.getTrendingCategories(limit);
};

/**
 * Get active stores
 */
export const getActiveStores = (limit) => {
  return trackingCacheService.getActiveStores(limit);
};

export default trackingCacheService;
