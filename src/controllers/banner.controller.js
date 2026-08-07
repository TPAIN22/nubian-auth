import Banner from '../models/banners.model.js';
import { invalidateHomeCache } from './home.controller.js';
import { resolveBannerTarget } from '../services/bannerTarget.service.js';
import { ServiceError } from '../lib/errors.js';
import logger from '../lib/logger.js';

/**
 * Fields an admin may write. Previously `req.body` went straight into Mongoose,
 * which meant a client could set `createdAt` (or anything a future schema adds)
 * on a whim. Everything outside this list is ignored.
 */
const WRITABLE_FIELDS = ['image', 'title', 'description', 'order', 'isActive'];

const pickWritable = (body) => {
  const out = {};
  for (const field of WRITABLE_FIELDS) {
    if (body[field] !== undefined) out[field] = body[field];
  }
  return out;
};

/** Map a ServiceError to its response; anything else stays a 500. */
const handleError = (res, error, context) => {
  if (error instanceof ServiceError) {
    return res.status(error.statusCode).json({
      message: error.message,
      code: error.code,
      ...(error.details && { details: error.details }),
    });
  }
  logger.error(context, { error: error.message });
  return res.status(500).json({ message: error.message });
};

export const getBanners = async (req, res) => {
  try {
    const banners = await Banner.find().sort({ order: 1, createdAt: -1 });
    res.status(200).json(banners);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createBanner = async (req, res) => {
  try {
    const payload = pickWritable(req.body);

    // `target` is absent for a plain static banner; leaving the field unset
    // (rather than writing `{ type: 'none' }`) keeps new documents identical in
    // shape to the ones that predate this feature.
    const target = await resolveBannerTarget(req.body.target);
    if (target.type !== 'none') payload.target = target;

    const banner = await Banner.create(payload);
    invalidateHomeCache();
    res.status(201).json(banner);
  } catch (error) {
    return handleError(res, error, 'Failed to create banner');
  }
};

export const updateBanner = async (req, res) => {
  try {
    // Operators are written explicitly rather than leaning on Mongoose to wrap
    // bare paths in `$set`: clearing a target needs `$unset`, and MongoDB
    // rejects an update document that mixes bare fields with an operator.
    const update = {};
    const $set = pickWritable(req.body);

    // Only touch the target when the client actually sent one, so a partial
    // update (e.g. toggling isActive) never clears an existing destination.
    if (req.body.target !== undefined) {
      const target = await resolveBannerTarget(req.body.target);
      if (target.type === 'none') {
        update.$unset = { target: '' };
      } else {
        $set.target = target;
      }
    }

    if (Object.keys($set).length > 0) update.$set = $set;
    if (Object.keys(update).length === 0) {
      const existing = await Banner.findById(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Banner not found' });
      return res.status(200).json(existing);
    }

    const banner = await Banner.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });
    if (!banner) return res.status(404).json({ message: 'Banner not found' });
    invalidateHomeCache();
    res.status(200).json(banner);
  } catch (error) {
    return handleError(res, error, 'Failed to update banner');
  }
};

export const deleteBanner = async (req, res) => {
  try {
    await Banner.findByIdAndDelete(req.params.id);
    invalidateHomeCache();
    res.status(200).json({ message: 'Banner deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
