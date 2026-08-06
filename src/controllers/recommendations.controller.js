// controllers/recommendations.controller.js
import { getAuth } from "@clerk/express";
import { sendSuccess, sendError, sendNotFound } from "../lib/response.js";
import logger from "../lib/logger.js";
import { convertProductPrices, getCurrencyContext } from "../services/currency.service.js";
import { enrichProductsWithPricing } from "./products.controller.js";
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

/**
 * Availability flag layered on top of the enriched product.
 *
 * This is the ONLY recommendation-specific field left here — pricing is owned
 * end-to-end by lib/pricing.engine.js via enrichProductsWithPricing. (The old
 * local `enrichProducts` re-implemented the pricing formula and used
 * `merchantPrice` — the COST — as the strikethrough, which made
 * `originalPrice === finalPrice` and `discount === 0` on literally every
 * product. See PRICING_AUDIT_REPORT Issue #2.)
 */
function withStockFlag(product) {
  if (!product) return product;
  const variants = Array.isArray(product.variants) ? product.variants : [];

  const hasStock = variants.length > 0
    ? variants.some((v) => v?.isActive !== false && toNumber(v?.stock, 0) > 0)
    : toNumber(product.stock, 0) > 0;

  return { ...product, hasStock };
}

/**
 * Canonical enrichment for every recommendation rail:
 * engine pricing (identical to /api/home and /api/products) + hasStock.
 */
function enrichRecommendationProducts(products) {
  if (!Array.isArray(products)) return [];
  return enrichProductsWithPricing(products).map(withStockFlag);
}

/**
 * Convert a flat list of already-enriched products.
 * Resolves the Currency row + FX rate ONCE per request instead of once per
 * product (convertProductPrices re-queries both when no context is supplied).
 */
async function convertList(products, currencyCode, label) {
  if (currencyCode === "USD" || !Array.isArray(products)) return products;
  try {
    const ctx = await getCurrencyContext(currencyCode);
    return await Promise.all(
      products.map((p) => convertProductPrices(p, currencyCode, ctx))
    );
  } catch (err) {
    logger.warn(`Currency conversion failed for ${label}`, {
      currencyCode,
      error: err.message,
    });
    // Graceful degradation: serve the USD payload rather than an empty rail.
    return products;
  }
}

/**
 * Convert a { railName: Product[] } map with a single currency context.
 */
async function convertRails(rails, keys, currencyCode, label) {
  if (currencyCode === "USD") return rails;
  try {
    const ctx = await getCurrencyContext(currencyCode);
    const out = { ...rails };
    await Promise.all(
      keys.map(async (key) => {
        if (!Array.isArray(out[key])) return;
        out[key] = await Promise.all(
          out[key].map((p) => convertProductPrices(p, currencyCode, ctx))
        );
      })
    );
    return out;
  } catch (err) {
    logger.warn(`Currency conversion failed for ${label}`, {
      currencyCode,
      error: err.message,
    });
    return rails;
  }
}

/**
 * GET /api/recommendations/home
 */
export const getHomeRecommendationsController = async (req, res) => {
  try {
    const { userId } = getAuth(req);

    const recommendations = await getHomeRecommendations(userId || null);

    const enrichedRecommendations = {
      forYou:        enrichRecommendationProducts(recommendations.forYou),
      trending:      enrichRecommendationProducts(recommendations.trending),
      flashDeals:    enrichRecommendationProducts(recommendations.flashDeals),
      newArrivals:   enrichRecommendationProducts(recommendations.newArrivals),
      brandsYouLove: enrichRecommendationProducts(recommendations.brandsYouLove),
    };

    const currencyCode = (req.currencyCode || "USD").toUpperCase();
    const payload = await convertRails(
      enrichedRecommendations,
      ["forYou", "trending", "flashDeals", "newArrivals", "brandsYouLove"],
      currencyCode,
      "home recommendations"
    );

    return sendSuccess(res, {
      data: payload,
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
      similarItems:             enrichRecommendationProducts(recommendations.similarItems),
      frequentlyBoughtTogether: enrichRecommendationProducts(recommendations.frequentlyBoughtTogether),
      youMayAlsoLike:           enrichRecommendationProducts(recommendations.youMayAlsoLike),
      cheaperAlternatives:      enrichRecommendationProducts(recommendations.cheaperAlternatives),
      fromSameStore:            enrichRecommendationProducts(recommendations.fromSameStore),
    };

    const currencyCode = (req.currencyCode || "USD").toUpperCase();
    const payload = await convertRails(
      enrichedRecommendations,
      [
        "similarItems",
        "frequentlyBoughtTogether",
        "youMayAlsoLike",
        "cheaperAlternatives",
        "fromSameStore",
      ],
      currencyCode,
      "product recommendations"
    );

    return sendSuccess(res, {
      data: payload,
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
    const enriched = enrichRecommendationProducts(recommendations);

    const currencyCode = (req.currencyCode || "USD").toUpperCase();
    const payload = await convertList(enriched, currencyCode, "cart recommendations");

    return sendSuccess(res, {
      data: payload,
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
    const enriched = enrichRecommendationProducts(recommendations);

    const currencyCode = (req.currencyCode || "USD").toUpperCase();
    const payload = await convertList(enriched, currencyCode, "user recommendations");

    return sendSuccess(res, {
      data: payload,
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
