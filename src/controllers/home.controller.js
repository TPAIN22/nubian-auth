import Banner from '../models/banners.model.js';
import Category from '../models/categories.model.js';
import Merchant from '../models/merchant.model.js';
import Currency from '../models/currency.model.js';
import { getLatestRate } from '../services/fx.service.js';
import { getHomeRecommendations } from '../services/recommendation.service.js';
import { sendSuccess } from '../lib/response.js';
import logger from '../lib/logger.js';
import { getAuth } from '@clerk/express';
import { convertProductPrices } from '../services/currency.service.js';
import { enrichProductsWithPricing } from './products.controller.js';

// Anonymous response cache (3-minute TTL)
let homeCache = null;
let cacheTime  = 0;
const TTL = 3 * 60 * 1000;

export const invalidateHomeCache = () => {
  homeCache = null;
  cacheTime  = 0;
  logger.info('Home cache invalidated');
};

export const getHomeData = async (req, res) => {
  try {
    const { userId }     = getAuth(req);
    const isAnon         = !userId;
    const currencyCode   = req.currencyCode?.toUpperCase();

    let response;

    // ── Anonymous cache hit ────────────────────────────────────────────────
    if (isAnon && homeCache && Date.now() - cacheTime < TTL) {
      response         = structuredClone(homeCache);
      response.forYou  = response.trending.slice(0, 6);
    } else {
      // ── Fetch static sections + product recommendations in parallel ──────
      const [
        banners,
        categories,
        recommendations,
        stores,
      ] = await Promise.all([
        Banner.find({ isActive: true }).sort({ order: 1 }).limit(10).lean(),
        Category.find({ isActive: true }).limit(12).lean(),
        getHomeRecommendations(userId || null),
        getStoreHighlights(),
      ]);

      response = {
        banners,
        categories,
        trending:    enrichProductsWithPricing(recommendations.trending),
        flashDeals:  enrichProductsWithPricing(recommendations.flashDeals),
        newArrivals: enrichProductsWithPricing(recommendations.newArrivals),
        forYou:      enrichProductsWithPricing(
          isAnon ? recommendations.trending.slice(0, 10) : recommendations.forYou
        ),
        stores,
      };

      if (isAnon) {
        homeCache = response;
        cacheTime  = Date.now();
      }
    }

    // ── Currency conversion ────────────────────────────────────────────────
    if (currencyCode && currencyCode !== 'USD') {
      try {
        const [config, rate] = await Promise.all([
          Currency.findOne({ code: currencyCode }).lean(),
          getLatestRate(currencyCode),
        ]);
        const ctx  = { config, rate };
        const keys = ['trending', 'flashDeals', 'newArrivals', 'forYou'];

        await Promise.all(
          keys.map(async (key) => {
            if (!response[key]) return;
            response[key] = await Promise.all(
              response[key].map(p => convertProductPrices(p, currencyCode, ctx))
            );
          })
        );
      } catch (e) {
        logger.warn('Home: currency conversion failed', { error: e.message });
      }
    }

    return sendSuccess(res, { data: response });
  } catch (err) {
    logger.error('Home: getHomeData error', { error: err.message });
    return res.status(500).json({ message: 'Home error' });
  }
};

// ── Private helper ────────────────────────────────────────────────────────────

async function getStoreHighlights() {
  const stores = await Merchant.find({ status: 'approved' })
    .sort({ averageRating: -1, approvedAt: -1 })
    .limit(10)
    .lean();

  return stores.map(s => ({
    _id:     s._id,
    name:    s.storeName,
    rating:  s.averageRating || 4.5,
    verified: true,
    logo:    s.logoUrl || null,
    banner:  s.banner || null,
  }));
}
