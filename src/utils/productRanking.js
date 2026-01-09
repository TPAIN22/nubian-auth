/**
 * Product Ranking System
 * 
 * HYBRID RANKING FORMULA:
 * rankingScore = (featured ? FEATURED_BOOST : 0)
 *              + (priorityScore * PRIORITY_WEIGHT)
 *              + freshnessBoost
 *              + stockBoost
 *              + personalizationBoost
 * 
 * RANKING STRATEGY:
 * 1. ADMIN PRIORITY (STRONGEST) - Admin controls via priorityScore & featured
 * 2. DYNAMIC BOOST (SECONDARY) - Freshness, stock availability
 * 3. PERSONALIZATION (LIGHT) - User category preferences (optional)
 * 
 * DESIGN PHILOSOPHY:
 * - Admin priority ALWAYS wins over dynamic signals
 * - Featured products get massive boost (1000 points)
 * - Priority score is multiplied by 100 for granular admin control
 * - Dynamic signals are smaller to ensure admin control dominance
 * - Personalization is lightest to not override admin intentions
 */

// RANKING CONSTANTS - Tuned for admin control dominance
const FEATURED_BOOST = 1000; // Featured products get massive boost (always appear first)
const PRIORITY_WEIGHT = 100; // Multiply priorityScore by this for granular control (0-100 becomes 0-10000)
const FRESHNESS_MAX_DAYS = 30; // Products newer than 30 days get freshness boost
const FRESHNESS_BOOST_MAX = 50; // Maximum freshness boost points
const STOCK_BOOST_THRESHOLD = 10; // Products with stock >= 10 get stock boost
const STOCK_BOOST_MAX = 30; // Maximum stock boost points
const PERSONALIZATION_BOOST = 20; // Light personalization boost for preferred categories

/**
 * Calculate freshness boost based on product creation date
 * Newer products get a boost, capped at FRESHNESS_BOOST_MAX
 * 
 * @param {Date} createdAt - Product creation date
 * @returns {number} Freshness boost score (0 to FRESHNESS_BOOST_MAX)
 */
function calculateFreshnessBoost(createdAt) {
  if (!createdAt) return 0;
  
  const now = new Date();
  const daysSinceCreation = (now - new Date(createdAt)) / (1000 * 60 * 60 * 24);
  
  if (daysSinceCreation > FRESHNESS_MAX_DAYS) {
    return 0; // No boost for old products
  }
  
  // Linear decay: newer = higher boost
  // Formula: maxBoost * (1 - (days / maxDays))
  const boost = FRESHNESS_BOOST_MAX * (1 - (daysSinceCreation / FRESHNESS_MAX_DAYS));
  return Math.max(0, Math.round(boost));
}

/**
 * Calculate stock availability boost
 * Products with good stock levels get a boost
 * 
 * @param {number} stock - Product stock quantity
 * @returns {number} Stock boost score (0 to STOCK_BOOST_MAX)
 */
function calculateStockBoost(stock) {
  if (!stock || stock < 0) return 0;
  
  // Boost for products with good stock (>= 10)
  if (stock >= STOCK_BOOST_THRESHOLD) {
    // Linear boost up to STOCK_BOOST_MAX
    // Products with 10+ stock get boost, capped at max
    const normalizedStock = Math.min(stock, STOCK_BOOST_THRESHOLD * 2); // Cap at 20
    const boost = (normalizedStock / (STOCK_BOOST_THRESHOLD * 2)) * STOCK_BOOST_MAX;
    return Math.round(boost);
  }
  
  // Low stock products get no boost
  return 0;
}

/**
 * Calculate personalization boost based on user category preferences
 * Light boost to promote products in user's preferred categories
 * 
 * @param {string|Object} productCategory - Product category (ObjectId or populated object)
 * @param {string[]} preferredCategories - Array of category IDs user prefers
 * @returns {number} Personalization boost score (0 or PERSONALIZATION_BOOST)
 */
function calculatePersonalizationBoost(productCategory, preferredCategories = []) {
  // Safe fallback: if no preferences, return 0
  if (!preferredCategories || preferredCategories.length === 0) {
    return 0;
  }
  
  if (!productCategory) {
    return 0;
  }
  
  // Extract category ID from object or use string directly
  const categoryId = typeof productCategory === 'object' 
    ? productCategory._id?.toString() || productCategory.toString()
    : productCategory.toString();
  
  // Check if product category matches any preferred category
  const isPreferred = preferredCategories.some(prefCat => {
    const prefCatId = typeof prefCat === 'object' 
      ? prefCat._id?.toString() || prefCat.toString()
      : prefCat.toString();
    return prefCatId === categoryId;
  });
  
  return isPreferred ? PERSONALIZATION_BOOST : 0;
}

/**
 * Calculate total ranking score for a product
 * 
 * @param {Object} product - Product document
 * @param {Object} options - Ranking options
 * @param {string[]} options.preferredCategories - User's preferred category IDs (optional)
 * @returns {number} Total ranking score (higher = better ranking)
 */
export function calculateRankingScore(product, options = {}) {
  const { preferredCategories = [] } = options;
  
  // Extract product data with safe fallbacks
  const featured = product.featured || false;
  const priorityScore = product.priorityScore || 0;
  const createdAt = product.createdAt;
  const stock = product.stock || 0;
  const category = product.category;
  
  // Calculate component scores
  const featuredBoost = featured ? FEATURED_BOOST : 0;
  const priorityBoost = priorityScore * PRIORITY_WEIGHT;
  const freshnessBoost = calculateFreshnessBoost(createdAt);
  const stockBoost = calculateStockBoost(stock);
  const personalizationBoost = calculatePersonalizationBoost(category, preferredCategories);
  
  // Total ranking score
  // Admin priority (featured + priority) dominates
  // Dynamic boosts (freshness + stock) provide secondary signals
  // Personalization provides light adjustment
  const totalScore = featuredBoost 
    + priorityBoost 
    + freshnessBoost 
    + stockBoost 
    + personalizationBoost;
  
  return totalScore;
}

/**
 * Calculate ranking scores for multiple products and sort them
 * This is used for client-side sorting when MongoDB aggregation is not feasible
 * 
 * @param {Array} products - Array of product documents
 * @param {Object} options - Ranking options
 * @param {string[]} options.preferredCategories - User's preferred category IDs (optional)
 * @returns {Array} Products sorted by ranking score (highest first)
 */
export function rankAndSortProducts(products, options = {}) {
  if (!Array.isArray(products) || products.length === 0) {
    return [];
  }
  
  // Calculate ranking score for each product
  const productsWithScores = products.map(product => {
    const score = calculateRankingScore(product, options);
    return {
      product,
      rankingScore: score,
    };
  });
  
  // Sort by ranking score (descending), then by createdAt (descending) for tie-breaking
  productsWithScores.sort((a, b) => {
    // Primary sort: ranking score (descending)
    if (b.rankingScore !== a.rankingScore) {
      return b.rankingScore - a.rankingScore;
    }
    
    // Tie-breaker: newer products first (descending createdAt)
    const aDate = new Date(a.product.createdAt || 0);
    const bDate = new Date(b.product.createdAt || 0);
    return bDate - aDate;
  });
  
  // Return sorted products
  return productsWithScores.map(item => item.product);
}

/**
 * Get user preferred categories from request/user data
 * This is a helper for extracting category preferences
 * 
 * @param {Object} req - Express request object
 * @returns {string[]} Array of preferred category IDs
 */
export function getUserPreferredCategories(req) {
  // TODO: Implement user preference tracking
  // For now, return empty array (safe fallback)
  // Future: Extract from user profile, order history, wishlist, etc.
  
  // Example future implementation:
  // const userId = getAuth(req).userId;
  // const user = await User.findOne({ clerkId: userId });
  // const preferredCategories = user?.preferredCategories || [];
  // return preferredCategories.map(cat => cat.toString());
  
  return [];
}

// Export constants for testing/debugging
export const RANKING_CONSTANTS = {
  FEATURED_BOOST,
  PRIORITY_WEIGHT,
  FRESHNESS_MAX_DAYS,
  FRESHNESS_BOOST_MAX,
  STOCK_BOOST_THRESHOLD,
  STOCK_BOOST_MAX,
  PERSONALIZATION_BOOST,
};