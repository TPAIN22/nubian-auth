// controllers/recommendations.controller.js
import { getAuth } from "@clerk/express";
import { sendSuccess, sendError, sendNotFound } from "../lib/response.js";
import logger from "../lib/logger.js";
import {
  getHomeRecommendations,
  getProductRecommendations,
  getCartRecommendations,
  getUserRecommendations,
} from "../services/recommendation.service.js";

/**
 * Helpers
 */
function toNumber(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function isActiveFlag(x) {
  // isActive undefined => treat as active (backward compatibility)
  return x !== false;
}

function getVariantAttrsObject(v) {
  if (!v) return {};
  const attrs = v.attributes;
  if (!attrs) return {};
  if (attrs instanceof Map) return Object.fromEntries(attrs.entries());
  if (typeof attrs === "object") return attrs;
  return {};
}

function pickEligibleVariants(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const eligible = variants.filter((v) => isActiveFlag(v?.isActive) && toNumber(v?.stock, 0) > 0);
  return { variants, eligible };
}

function getSellingPriceForSimple(product) {
  // selling = dynamic finalPrice first
  return (
    toNumber(product?.finalPrice, 0) ||
    toNumber(product?.merchantPrice, 0) ||
    toNumber(product?.price, 0) ||
    0
  );
}

function getOriginalPriceForSimple(product) {
  // original/compare-at = discountPrice (legacy) if exists, else merchantPrice/price
  const discountPrice = toNumber(product?.discountPrice, 0);
  if (discountPrice > 0) return discountPrice;

  return toNumber(product?.merchantPrice, 0) || toNumber(product?.price, 0) || 0;
}

function getVariantSellingPrice(v) {
  // selling = finalPrice first (dynamic), else merchantPrice/price
  return toNumber(v?.finalPrice, 0) || toNumber(v?.merchantPrice, 0) || toNumber(v?.price, 0) || 0;
}

function getVariantOriginalPrice(v) {
  // original = discountPrice if exists, else merchantPrice/price
  const dp = toNumber(v?.discountPrice, 0);
  if (dp > 0) return dp;
  return toNumber(v?.merchantPrice, 0) || toNumber(v?.price, 0) || 0;
}

function calcDiscountPercent(original, selling) {
  const o = toNumber(original, 0);
  const s = toNumber(selling, 0);
  if (o <= 0) return 0;
  if (s <= 0) return 0;
  if (s >= o) return 0;
  return Math.round(((o - s) / o) * 100);
}

/**
 * Enrich products with calculated fields (hasStock, discount, finalPrice, merchantPrice, originalPrice)
 * NOTE:
 * - finalPrice here means SELLING price (dynamic pricing) that UI should display.
 * - discountPrice is treated as compare-at / old price (NOT selling).
 * - For variant products: use lowest eligible variant (active + in-stock).
 */
function enrichProducts(products) {
  if (!Array.isArray(products)) return [];

  return products.map((product) => {
    const { variants, eligible } = pickEligibleVariants(product);

    const hasVariants = variants.length > 0;
    const hasStock = hasVariants
      ? eligible.length > 0
      : toNumber(product?.stock, 0) > 0;

    // Pick a representative variant for pricing (lowest eligible; fallback to lowest overall)
    let representativeVariant = null;
    if (hasVariants) {
      const list = eligible.length ? eligible : variants;
      representativeVariant =
        list
          .slice()
          .sort((a, b) => getVariantSellingPrice(a) - getVariantSellingPrice(b))[0] || null;
    }

    let sellingPrice = 0;
    let originalPrice = 0;
    let merchantPrice = 0;

    if (representativeVariant) {
      sellingPrice = getVariantSellingPrice(representativeVariant);
      originalPrice = getVariantOriginalPrice(representativeVariant);
      merchantPrice = toNumber(representativeVariant?.merchantPrice, 0) || toNumber(representativeVariant?.price, 0) || 0;
    } else {
      sellingPrice = getSellingPriceForSimple(product);
      originalPrice = getOriginalPriceForSimple(product);
      merchantPrice = toNumber(product?.merchantPrice, 0) || toNumber(product?.price, 0) || 0;
    }

    // Ensure originalPrice >= sellingPrice for display consistency
    if (originalPrice > 0 && sellingPrice > 0) {
      originalPrice = Math.max(originalPrice, sellingPrice);
    }

    const discount = calcDiscountPercent(originalPrice, sellingPrice);

    const nubianMarkup = toNumber(product?.nubianMarkup, 10);
    const dynamicMarkup = toNumber(product?.dynamicMarkup, 0);

    // If variant selected, prefer variant markup values if provided
    const pricingBreakdown = representativeVariant
      ? {
          merchantPrice,
          nubianMarkup: toNumber(representativeVariant?.nubianMarkup, nubianMarkup),
          dynamicMarkup: toNumber(representativeVariant?.dynamicMarkup, dynamicMarkup),
          finalPrice: sellingPrice,
        }
      : {
          merchantPrice,
          nubianMarkup,
          dynamicMarkup,
          finalPrice: sellingPrice,
        };

    return {
      ...product,
      hasStock,
      discount,

      // ✅ IMPORTANT: keep these names consistent for the app
      finalPrice: sellingPrice,     // SELLING price (dynamic pricing)
      merchantPrice,                // base merchant price
      originalPrice,                // compare-at/old price for UI

      pricingBreakdown,

      // Optional: expose chosen variant preview for debugging/UI if you want
      recommendedPricingVariant: representativeVariant
        ? {
            _id: representativeVariant._id,
            stock: representativeVariant.stock,
            isActive: representativeVariant.isActive,
            attributes: getVariantAttrsObject(representativeVariant),
            finalPrice: getVariantSellingPrice(representativeVariant),
            originalPrice: getVariantOriginalPrice(representativeVariant),
          }
        : null,
    };
  });
}

/**
 * GET /api/recommendations/home
 */
export const getHomeRecommendationsController = async (req, res) => {
  try {
    const { userId } = getAuth(req);

    const recommendations = await getHomeRecommendations(userId || null);

    const enrichedRecommendations = {
      forYou: enrichProducts(recommendations.forYou),
      trending: enrichProducts(recommendations.trending),
      flashDeals: enrichProducts(recommendations.flashDeals),
      newArrivals: enrichProducts(recommendations.newArrivals),
      brandsYouLove: enrichProducts(recommendations.brandsYouLove),
    };

    return sendSuccess(res, {
      data: enrichedRecommendations,
      message: "Home recommendations retrieved successfully",
    });
  } catch (error) {
    logger.error("Error getting home recommendations", {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
    return sendError(
      res,
      { message: "Failed to get home recommendations", error: error.message },
      500
    );
  }
};

/**
 * GET /api/recommendations/product/:id
 */
export const getProductRecommendationsController = async (req, res) => {
  try {
    const { id: productId } = req.params;
    const { userId } = getAuth(req);

    if (!productId) {
      return sendError(res, { message: "Product ID is required" }, 400);
    }

    const recommendations = await getProductRecommendations(productId, userId || null);

    const enrichedRecommendations = {
      similarItems: enrichProducts(recommendations.similarItems),
      frequentlyBoughtTogether: enrichProducts(recommendations.frequentlyBoughtTogether),
      youMayAlsoLike: enrichProducts(recommendations.youMayAlsoLike),
      cheaperAlternatives: enrichProducts(recommendations.cheaperAlternatives),
      fromSameStore: enrichProducts(recommendations.fromSameStore),
    };

    return sendSuccess(res, {
      data: enrichedRecommendations,
      message: "Product recommendations retrieved successfully",
    });
  } catch (error) {
    logger.error("Error getting product recommendations", {
      requestId: req.requestId,
      productId: req.params.id,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });

    if (error.message === "Product not found") {
      return sendNotFound(res, { message: "Product not found" });
    }

    return sendError(
      res,
      { message: "Failed to get product recommendations", error: error.message },
      500
    );
  }
};

/**
 * GET /api/recommendations/cart
 */
export const getCartRecommendationsController = async (req, res) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      return sendError(res, { message: "Authentication required" }, 401);
    }

    const recommendations = await getCartRecommendations(userId);
    const enrichedRecommendations = enrichProducts(recommendations);

    return sendSuccess(res, {
      data: enrichedRecommendations,
      message: "Cart recommendations retrieved successfully",
    });
  } catch (error) {
    logger.error("Error getting cart recommendations", {
      requestId: req.requestId,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
    return sendError(
      res,
      { message: "Failed to get cart recommendations", error: error.message },
      500
    );
  }
};

/**
 * GET /api/recommendations/user/:id
 */
export const getUserRecommendationsController = async (req, res) => {
  try {
    const { id: userId } = req.params;
    const { userId: authUserId } = getAuth(req);

    const targetUserId = userId || authUserId;

    if (!targetUserId) {
      return sendError(res, { message: "User ID is required" }, 400);
    }

    const recommendations = await getUserRecommendations(targetUserId);
    const enrichedRecommendations = enrichProducts(recommendations);

    return sendSuccess(res, {
      data: enrichedRecommendations,
      message: "User recommendations retrieved successfully",
    });
  } catch (error) {
    logger.error("Error getting user recommendations", {
      requestId: req.requestId,
      userId: req.params.id,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
    return sendError(
      res,
      { message: "Failed to get user recommendations", error: error.message },
      500
    );
  }
};
