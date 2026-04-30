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

// Anonymous response cache, keyed per currency. Each entry stores the
// ALREADY-CONVERTED payload so we never mutate it again on subsequent reads.
// key = `${currency}:${rateProvider}:${rateDate}:${rate}` — the rate fingerprint
// guards against admin manualRate updates and FX provider rolls.
const TTL = 3 * 60 * 1000;
const homeCache = new Map();

export const invalidateHomeCache = () => {
  homeCache.clear();
  logger.info('Home cache invalidated');
};

const cacheKey = (currency, rateInfo) =>
  `${currency}:${rateInfo?.provider || 'na'}:${rateInfo?.date || 'na'}:${rateInfo?.rate ?? 'na'}`;

async function buildUsdPayload(userId) {
  const [banners, categories, recommendations, stores] = await Promise.all([
    Banner.find({ isActive: true }).sort({ order: 1 }).limit(10).lean(),
    Category.find({ isActive: true }).limit(12).lean(),
    getHomeRecommendations(userId || null),
    getStoreHighlights(),
  ]);

  return {
    banners,
    categories,
    trending:      enrichProductsWithPricing(recommendations.trending),
    flashDeals:    enrichProductsWithPricing(recommendations.flashDeals),
    newArrivals:   enrichProductsWithPricing(recommendations.newArrivals),
    brandsYouLove: enrichProductsWithPricing(recommendations.brandsYouLove),
    forYou:        enrichProductsWithPricing(
      !userId ? recommendations.trending.slice(0, 10) : recommendations.forYou,
    ),
    stores,
  };
}

async function convertHomePayload(usdPayload, currencyCode, rateInfo) {
  if (!currencyCode || currencyCode === 'USD') return usdPayload;

  const config = await Currency.findOne({ code: currencyCode }).lean();
  const ctx = { config, rate: rateInfo };
  const keys = ['trending', 'flashDeals', 'newArrivals', 'forYou', 'brandsYouLove'];

  // Build a NEW object — never mutate the input.
  const out = { ...usdPayload };
  await Promise.all(
    keys.map(async (k) => {
      if (!Array.isArray(out[k])) return;
      out[k] = await Promise.all(
        out[k].map((p) => convertProductPrices(p, currencyCode, ctx)),
      );
    }),
  );
  return out;
}

export const getHomeData = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const isAnon = !userId;
    const currencyCode = (req.currencyCode || 'USD').toUpperCase();

    // Resolve FX rate up-front so it's part of the cache key (manualRate / provider drift safety).
    const rateInfo = currencyCode === 'USD'
      ? { rate: 1, date: null, provider: 'system', rateUnavailable: false }
      : await getLatestRate(currencyCode);

    const key = cacheKey(currencyCode, rateInfo);

    if (isAnon) {
      const hit = homeCache.get(key);
      if (hit && Date.now() - hit.at < TTL) {
        return sendSuccess(res, { data: structuredClone(hit.payload) });
      }
    }

    let response;
    try {
      const usd = await buildUsdPayload(userId);
      response = await convertHomePayload(usd, currencyCode, rateInfo);
    } catch (e) {
      logger.warn('Home: currency conversion failed', { currencyCode, error: e.message });
      // Fall back to USD payload on conversion failure rather than a partial mix.
      response = await buildUsdPayload(userId);
    }

    if (isAnon) {
      homeCache.set(key, { payload: response, at: Date.now() });
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
