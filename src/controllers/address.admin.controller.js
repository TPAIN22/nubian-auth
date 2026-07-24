/**
 * Admin address browsing for the dashboard.
 *
 * Read-only on purpose: an admin inspecting where orders go should never be
 * able to silently rewrite a shopper's saved address. Corrections happen
 * through support, and past orders are immune either way because they carry
 * their own snapshot.
 */
import Address from '../models/address.model.js';
import { getGeoService } from '../services/geo/index.js';
import { sendError, sendSuccess, sendPaginated } from '../lib/response.js';
import { composeAddressLine, getCoordinates } from '../lib/address.js';
import logger from '../lib/logger.js';

/** Escape user input before it reaches a $regex, so a stray `.*` can't scan the collection. */
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Flatten an address into the row shape the dashboard table renders.
 * Keeps map-preview concerns (a ready-to-use static image URL) on the server so
 * the dashboard never needs a map vendor key.
 */
const toAdminRow = (doc) => {
  const coords = getCoordinates(doc);

  return {
    _id: doc._id,
    user: doc.user,
    name: doc.name,
    phone: doc.phone,
    whatsapp: doc.whatsapp,

    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
    hasCoordinates: Boolean(coords),

    formattedAddress: composeAddressLine(doc),
    city: doc.city || doc.cityName || '',
    country: doc.country || doc.countryName || '',
    countryCode: doc.countryCode || '',
    administrativeArea: doc.administrativeArea || '',
    neighborhood: doc.neighborhood || doc.area || doc.subCityName || '',
    postalCode: doc.postalCode || '',

    building: doc.building || '',
    floor: doc.floor || '',
    apartment: doc.apartment || '',
    landmark: doc.landmark || '',
    notes: doc.notes || '',

    placeId: doc.placeId || '',
    plusCode: doc.plusCode || '',
    addressLabel: doc.addressLabel || 'other',
    locationSource: doc.locationSource || 'legacy',
    addressConfidence: doc.addressConfidence || 'low',
    geocodeAccuracy: doc.geocodeAccuracy || 'unknown',
    locationAccuracyMeters:
      typeof doc.locationAccuracyMeters === 'number' ? doc.locationAccuracyMeters : null,
    isDefault: Boolean(doc.isDefault),
    isLegacy: Boolean(doc.isLegacy),
    schemaVersion: doc.schemaVersion ?? 1,

    // Proxied through /api/geo/static — no vendor key reaches the browser.
    mapPreviewUrl: coords
      ? `/api/geo/static?lat=${coords.lat}&lng=${coords.lng}&zoom=16&width=480&height=240`
      : null,

    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

/**
 * GET /api/admin/addresses
 *
 * Search, filter, sort and paginate every saved address.
 * Supports a `bbox` viewport filter so the dashboard can show delivery density
 * on a map without pulling the whole collection.
 */
export const listAddresses = async (req, res) => {
  try {
    const {
      search,
      countryCode,
      city,
      label,
      hasCoordinates,
      isLegacy,
      userId,
      bbox,
      sortBy = 'updatedAt',
      sortOrder = 'desc',
      page = 1,
      limit = 25,
    } = req.query;

    // Collected as independent AND clauses. Both `city` and `search` need their
    // own $or (each spans the v2 and legacy field for the same concept), and a
    // single object can only hold one $or key — so everything goes through $and.
    const clauses = [];

    if (userId) clauses.push({ user: userId });
    if (countryCode) clauses.push({ countryCode });
    if (label) clauses.push({ addressLabel: label });
    if (typeof isLegacy === 'boolean') clauses.push({ isLegacy });

    if (typeof hasCoordinates === 'boolean') {
      clauses.push({ 'location.coordinates': { $exists: hasCoordinates } });
    }

    if (city) {
      const rx = new RegExp(escapeRegex(city), 'i');
      clauses.push({ $or: [{ city: rx }, { cityName: rx }] });
    }

    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = String(bbox).split(',').map(Number);
      clauses.push({
        location: {
          $geoWithin: {
            $box: [
              [minLng, minLat],
              [maxLng, maxLat],
            ],
          },
        },
      });
    }

    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      // Search spans both generations: a v2 row matches on formattedAddress,
      // a legacy row on the hierarchy names it was built from.
      clauses.push({
        $or: [
          { name: rx },
          { phone: rx },
          { formattedAddress: rx },
          { city: rx },
          { cityName: rx },
          { subCityName: rx },
          { area: rx },
          { street: rx },
          { landmark: rx },
        ],
      });
    }

    const filter = clauses.length ? { $and: clauses } : {};

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [rows, total] = await Promise.all([
      Address.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email phoneNumber')
        .lean(),
      Address.countDocuments(filter),
    ]);

    return sendPaginated(res, {
      data: rows.map(toAdminRow),
      page,
      limit,
      total,
      message: 'Addresses retrieved successfully',
    });
  } catch (error) {
    logger.error('admin listAddresses failed', {
      requestId: req.requestId,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to retrieve addresses',
      code: 'ADDRESSES_RETRIEVE_ERROR',
    });
  }
};

/** GET /api/admin/addresses/:id */
export const getAddressById = async (req, res) => {
  try {
    const doc = await Address.findById(req.params.id)
      .populate('user', 'name email phoneNumber')
      .lean();

    if (!doc) {
      return sendError(res, {
        message: 'Address not found',
        code: 'ADDRESS_NOT_FOUND',
        statusCode: 404,
      });
    }

    return sendSuccess(res, {
      data: toAdminRow(doc),
      message: 'Address retrieved successfully',
    });
  } catch (error) {
    logger.error('admin getAddressById failed', {
      requestId: req.requestId,
      addressId: req.params.id,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to retrieve address',
      code: 'ADDRESS_RETRIEVE_ERROR',
    });
  }
};

/**
 * GET /api/admin/addresses/stats
 * Migration progress and coverage, for the ops view.
 */
export const getAddressStats = async (req, res) => {
  try {
    const [total, withCoordinates, legacy, byLabel, topCities] = await Promise.all([
      Address.countDocuments({}),
      Address.countDocuments({ 'location.coordinates': { $exists: true } }),
      Address.countDocuments({ isLegacy: true }),
      Address.aggregate([{ $group: { _id: '$addressLabel', count: { $sum: 1 } } }]),
      Address.aggregate([
        { $group: { _id: { $ifNull: ['$city', '$cityName'] }, count: { $sum: 1 } } },
        { $match: { _id: { $nin: [null, ''] } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    return sendSuccess(res, {
      data: {
        total,
        withCoordinates,
        withoutCoordinates: total - withCoordinates,
        legacy,
        migratedPct: total ? Number(((withCoordinates / total) * 100).toFixed(1)) : 0,
        byLabel: Object.fromEntries(byLabel.map((r) => [r._id || 'unknown', r.count])),
        topCities: topCities.map((r) => ({ city: r._id, count: r.count })),
        geo: getGeoService().stats(),
      },
      message: 'Address stats retrieved successfully',
    });
  } catch (error) {
    logger.error('admin getAddressStats failed', {
      requestId: req.requestId,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to retrieve address stats',
      code: 'ADDRESS_STATS_ERROR',
    });
  }
};
