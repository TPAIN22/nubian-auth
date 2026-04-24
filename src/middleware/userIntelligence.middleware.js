import UserActivity from '../models/userActivity.model.js';
import { getAuth } from '@clerk/express';
import logger from '../lib/logger.js';

// All tracking is fire-and-forget writes to UserActivity (TTL-indexed collection).
// Previously wrote to User embedded arrays — those fields were removed in the models
// audit due to unbounded document growth risk. UserActivity has a 90-day TTL and
// is the correct store for behavioural signals.

function getClerkId(req) {
  try { return getAuth(req)?.userId || null; }
  catch { return null; }
}

function getIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

function track(event, data) {
  UserActivity.create(data).catch(err =>
    logger.warn(`Failed to track ${event}`, { error: err.message })
  );
}

export const recordProductView = (req, _res, next) => {
  const userId = getClerkId(req);
  const productId = req.params.productId || req.params.id;
  if (userId && productId) {
    track('product_view', {
      userId,
      sessionId: req.requestId || 'unknown',
      event: 'product_view',
      productId,
      device: req.headers['x-platform'] || undefined,
      timestamp: new Date(),
    });
  }
  next();
};

export const recordProductClick = (req, _res, next) => {
  const userId = getClerkId(req);
  const productId = req.params.productId || req.params.id;
  if (userId && productId) {
    track('product_click', {
      userId,
      sessionId: req.requestId || 'unknown',
      event: 'product_click',
      productId,
      device: req.headers['x-platform'] || undefined,
      timestamp: new Date(),
    });
  }
  next();
};

export const recordCartEvent = (req, _res, next) => {
  const userId = getClerkId(req);
  const productId = req.body?.productId;
  const event = (req.method === 'POST' || req.method === 'PUT') ? 'add_to_cart' : 'remove_from_cart';
  if (userId && productId) {
    track(event, {
      userId,
      sessionId: req.requestId || 'unknown',
      event,
      productId,
      device: req.headers['x-platform'] || undefined,
      timestamp: new Date(),
    });
  }
  next();
};

export const recordSearch = (req, _res, next) => {
  const userId = getClerkId(req);
  const keyword = req.query.q || req.query.query || req.query.keyword || req.query.search;
  if (userId && keyword && typeof keyword === 'string' && keyword.trim()) {
    track('search_query', {
      userId,
      sessionId: req.requestId || 'unknown',
      event: 'search_query',
      searchQuery: keyword.trim().toLowerCase().slice(0, 200),
      device: req.headers['x-platform'] || undefined,
      timestamp: new Date(),
    });
  }
  next();
};

export const recordCategoryOpen = (req, _res, next) => {
  const userId = getClerkId(req);
  const categoryId = req.params.categoryId || req.params.id;
  if (userId && categoryId) {
    track('category_open', {
      userId,
      sessionId: req.requestId || 'unknown',
      event: 'category_open',
      categoryId,
      device: req.headers['x-platform'] || undefined,
      timestamp: new Date(),
    });
  }
  next();
};

// Called after order completion — records purchased categories in UserActivity
export const updateUserPreferencesFromOrder = (userId, order) => {
  if (!order?.products?.length) return;
  // Purchase events are recorded by notificationEventHandlers when order is delivered.
  // No additional tracking needed here — UserActivity.purchase events cover this.
};
