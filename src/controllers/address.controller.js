import Address from '../models/address.model.js';
import Country from '../models/country.model.js';
import City from '../models/city.model.js';
import SubCity from '../models/subcity.model.js';
import { getGeoService } from '../services/geo/index.js';
import {
  ADDRESS_LABEL,
  LOCATION_SOURCE,
  deriveAddressConfidence,
  isValidCoordinate,
} from '../services/geo/types.js';
import { applyGeoAddress, toGeoPoint } from '../lib/address.js';
import { COVERAGE, evaluateCoverage } from '../services/deliveryArea.service.js';
import logger from '../lib/logger.js';

/**
 * Fields a client may write directly.
 *
 * Split into three groups on purpose:
 *  - LEGACY_FIELDS are still accepted so older app builds keep working
 *    unchanged. They are not deprecated at the API level, only in the UI.
 *  - GEO_INPUT_FIELDS are the map-first inputs.
 *  - Derived fields (formattedAddress, city, countryCode, …) are deliberately
 *    absent: they come from the geocoder, not the client, so a client cannot
 *    claim a pin is somewhere it isn't.
 */
const CONTACT_FIELDS = ['name', 'phone', 'whatsapp', 'notes', 'isDefault'];

const LEGACY_FIELDS = ['countryId', 'cityId', 'subCityId', 'area', 'street', 'building'];

const GEO_INPUT_FIELDS = [
  'latitude',
  'longitude',
  'placeId',
  'building',
  'floor',
  'apartment',
  'landmark',
  'addressLabel',
  'locationSource',
  'locationAccuracyMeters',
];

/**
 * Client field names accepted as aliases for a canonical field.
 * Keeps older app builds working after a rename.
 */
const FIELD_ALIASES = { gpsAccuracyMeters: 'locationAccuracyMeters' };

const ALLOWED_FIELDS = [...new Set([...CONTACT_FIELDS, ...LEGACY_FIELDS, ...GEO_INPUT_FIELDS])];

const GENERIC_ERROR = 'Something went wrong';

const pickAllowed = (body = {}) => {
  const picked = ALLOWED_FIELDS.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

  for (const [alias, canonical] of Object.entries(FIELD_ALIASES)) {
    if (body[alias] !== undefined && picked[canonical] === undefined) {
      picked[canonical] = body[alias];
    }
  }

  return picked;
};

/**
 * Resolve legacy hierarchy ids into display names.
 * Unchanged behaviour — old clients that still send countryId/cityId/subCityId
 * get exactly the same validation and the same stored names as before.
 */
const resolveLocation = async ({ countryId, cityId, subCityId }) => {
  const [country, city, subCity] = await Promise.all([
    countryId ? Country.findById(countryId).select('nameEn').lean() : null,
    cityId ? City.findById(cityId).select('nameEn countryId').lean() : null,
    subCityId ? SubCity.findById(subCityId).select('nameEn cityId').lean() : null,
  ]);

  if (countryId && !country) return { error: 'Invalid countryId' };
  if (cityId && !city) return { error: 'Invalid cityId' };
  if (subCityId && !subCity) return { error: 'Invalid subCityId' };

  if (city && countryId && String(city.countryId) !== String(countryId)) {
    return { error: 'City does not belong to the specified country' };
  }
  if (subCity && cityId && String(subCity.cityId) !== String(cityId)) {
    return { error: 'SubCity does not belong to the specified city' };
  }

  return {
    names: {
      countryName: country?.nameEn || '',
      cityName: city?.nameEn || '',
      subCityName: subCity?.nameEn || '',
    },
  };
};

/**
 * Turn a client payload into a persistable address patch.
 *
 * When coordinates are present the server reverse-geocodes them itself rather
 * than trusting client-supplied labels, then marks the row as v2/non-legacy.
 * A geocoder failure is **not** an error: the pin is the deliverable part, the
 * label is a nicety, and blocking a save on a third-party outage would be a
 * worse product than an address with no formatted line.
 *
 * Delivery coverage *is* enforced here, against the pin rather than any
 * geocoded name — see `deliveryArea.service.js` for why names can't be trusted.
 * This is the early gate: it stops a shopper filling in a whole address form
 * before finding out at checkout that we don't deliver there. It is not the
 * authoritative one — `order.service.resolveAddress` re-checks, because a zone
 * can be redrawn long after an address was saved.
 *
 * @returns {Promise<{ data?: Object, error?: string, code?: string }>}
 */
const buildAddressPatch = async (body, { requestId } = {}) => {
  const data = pickAllowed(body);

  // ── Legacy hierarchy path ────────────────────────────────────────────────
  if (data.countryId || data.cityId || data.subCityId) {
    const result = await resolveLocation(data);
    if (result.error) return { error: result.error };
    Object.assign(data, result.names);
  }

  // ── Map-first path ───────────────────────────────────────────────────────
  const { latitude, longitude } = data;
  delete data.latitude;
  delete data.longitude;

  const hasCoordinateInput = latitude !== undefined || longitude !== undefined;

  if (hasCoordinateInput) {
    if (!isValidCoordinate(latitude, longitude)) {
      return { error: 'latitude and longitude must be a valid coordinate pair' };
    }

    data.location = toGeoPoint(latitude, longitude);
    data.schemaVersion = 2;
    data.isLegacy = false;

    if (!Object.values(LOCATION_SOURCE).includes(data.locationSource)) {
      data.locationSource = LOCATION_SOURCE.MAP_PIN;
    }

    try {
      // Prefer resolving through the place id the client picked from search —
      // it names the actual business/landmark, which reverse geocoding on the
      // same coordinates would flatten to a street.
      const geo = data.placeId
        ? await getGeoService().placeDetails({ id: data.placeId })
        : null;

      applyGeoAddress(
        data,
        geo ?? (await getGeoService().reverseGeocode({ lat: latitude, lng: longitude })),
      );
    } catch (error) {
      logger.warn('address: reverse geocode failed, saving pin without a label', {
        requestId,
        error: error.message,
      });
    }

    const coverage = await evaluateCoverage({ location: data.location }, { requestId });

    if (coverage.status === COVERAGE.OUTSIDE) {
      logger.info('address: rejected a pin outside the delivery area', {
        requestId,
        lat: latitude,
        lng: longitude,
        city: data.city || null,
      });

      return {
        error: 'We do not deliver to this location yet',
        code: 'OUT_OF_SERVICE_AREA',
      };
    }
  }

  if (data.addressLabel && !Object.values(ADDRESS_LABEL).includes(data.addressLabel)) {
    return { error: `addressLabel must be one of: ${Object.values(ADDRESS_LABEL).join(', ')}` };
  }

  // Confidence is always server-derived. A client cannot assert that its
  // address is trustworthy — that has to follow from how the pin was obtained.
  if (hasCoordinateInput) {
    data.addressConfidence = deriveAddressConfidence({
      locationSource: data.locationSource,
      hasCoordinates: Boolean(data.location),
    });
  }

  // Accuracy in metres is only meaningful for a device fix. Drop it otherwise
  // rather than storing a number that describes nothing.
  if (data.locationSource !== LOCATION_SOURCE.GPS) {
    data.locationAccuracyMeters = null;
  }

  return { data };
};

const clearDefaultFor = (userId) =>
  Address.updateMany({ user: userId, isDefault: true }, { $set: { isDefault: false } });

const isDuplicateKeyError = (err) => err && err.code === 11000;

export const getAddresses = async (req, res) => {
  try {
    // Not .lean(): clients read the `latitude` / `longitude` virtuals, and
    // Mongoose core does not project virtuals onto lean results. A user has a
    // handful of addresses, so hydrating them is free.
    const addresses = await Address.find({ user: req.appUser._id })
      .sort({ isDefault: -1, updatedAt: -1 });

    return res.status(200).json(addresses.map((a) => a.toJSON()));
  } catch (error) {
    logger.error('getAddresses failed', {
      requestId: req.requestId,
      userId: req.appUser?._id,
      error: error.message,
    });
    return res.status(500).json({ message: GENERIC_ERROR });
  }
};

export const addAddress = async (req, res) => {
  const userId = req.appUser._id;

  try {
    const { data, error, code } = await buildAddressPatch(req.body, { requestId: req.requestId });
    if (error) return res.status(400).json({ message: error, ...(code && { code }) });

    if (data.isDefault) {
      await clearDefaultFor(userId);
    }

    const address = await Address.create({ ...data, user: userId });
    return res.status(201).json(address.toJSON());
  } catch (error) {
    // A concurrent write can leave two rows flagged default; clear and retry once.
    if (isDuplicateKeyError(error)) {
      try {
        await clearDefaultFor(userId);
        const { data, error: retryRejection, code: retryCode } = await buildAddressPatch(
          req.body,
          { requestId: req.requestId }
        );
        // Coverage can flip between the two attempts (a zone deactivated
        // mid-request); without this the retry would spread `undefined`.
        if (retryRejection) {
          return res.status(400).json({ message: retryRejection, ...(retryCode && { code: retryCode }) });
        }
        const address = await Address.create({ ...data, user: userId });
        return res.status(201).json(address.toJSON());
      } catch (retryError) {
        logger.error('addAddress retry failed', {
          requestId: req.requestId,
          userId,
          error: retryError.message,
        });
        return res.status(500).json({ message: GENERIC_ERROR });
      }
    }

    logger.error('addAddress failed', {
      requestId: req.requestId,
      userId,
      error: error.message,
    });
    return res.status(500).json({ message: GENERIC_ERROR });
  }
};

export const updateAddress = async (req, res) => {
  const userId = req.appUser._id;
  const { id } = req.params;

  try {
    const { data, error, code } = await buildAddressPatch(req.body, { requestId: req.requestId });
    if (error) return res.status(400).json({ message: error, ...(code && { code }) });

    if (data.isDefault) {
      await Address.updateMany(
        { user: userId, isDefault: true, _id: { $ne: id } },
        { $set: { isDefault: false } }
      );
    }

    const address = await Address.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: data },
      { new: true, runValidators: true }
    );

    if (!address) {
      return res.status(404).json({ message: 'Address not found' });
    }

    return res.status(200).json(address.toJSON());
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ message: 'Default address conflict, please retry' });
    }

    logger.error('updateAddress failed', {
      requestId: req.requestId,
      userId,
      addressId: id,
      error: error.message,
    });
    return res.status(500).json({ message: GENERIC_ERROR });
  }
};

export const deleteAddress = async (req, res) => {
  const userId = req.appUser._id;
  const { id } = req.params;

  try {
    const deleted = await Address.findOneAndDelete({ _id: id, user: userId });

    if (!deleted) {
      return res.status(404).json({ message: 'Address not found' });
    }

    // Deleting an address never affects past orders — each order froze its own
    // snapshot at checkout (see Order.addressSnapshot).
    if (deleted.isDefault) {
      const fallback = await Address.findOne({ user: userId })
        .sort({ updatedAt: -1 })
        .select('_id');

      if (fallback) {
        try {
          await Address.updateOne(
            { _id: fallback._id, user: userId },
            { $set: { isDefault: true } }
          );
        } catch (promoteError) {
          logger.warn('deleteAddress: failed to promote fallback default', {
            requestId: req.requestId,
            userId,
            fallbackId: fallback._id,
            error: promoteError.message,
          });
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error('deleteAddress failed', {
      requestId: req.requestId,
      userId,
      addressId: id,
      error: error.message,
    });
    return res.status(500).json({ message: GENERIC_ERROR });
  }
};

export const setDefaultAddress = async (req, res) => {
  const userId = req.appUser._id;
  const { id } = req.params;

  try {
    const target = await Address.findOne({ _id: id, user: userId }).select('_id');
    if (!target) {
      return res.status(404).json({ message: 'Address not found' });
    }

    await Address.updateMany(
      { user: userId, isDefault: true, _id: { $ne: id } },
      { $set: { isDefault: false } }
    );

    const address = await Address.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: { isDefault: true } },
      { new: true }
    );

    if (!address) {
      return res.status(404).json({ message: 'Address not found' });
    }

    return res.status(200).json(address.toJSON());
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ message: 'Default address conflict, please retry' });
    }

    logger.error('setDefaultAddress failed', {
      requestId: req.requestId,
      userId,
      addressId: id,
      error: error.message,
    });
    return res.status(500).json({ message: GENERIC_ERROR });
  }
};
