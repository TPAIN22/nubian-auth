import Address from '../models/address.model.js';
import Country from '../models/country.model.js';
import City from '../models/city.model.js';
import SubCity from '../models/subcity.model.js';
import logger from '../lib/logger.js';

const ALLOWED_FIELDS = [
  'name',
  'phone',
  'whatsapp',
  'countryId',
  'cityId',
  'subCityId',
  'area',
  'street',
  'building',
  'notes',
  'isDefault',
];

const GENERIC_ERROR = 'Something went wrong';

const pickAllowed = (body = {}) =>
  ALLOWED_FIELDS.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

const resolveLocation = async ({ countryId, cityId, subCityId }) => {
  const [country, city, subCity] = await Promise.all([
    countryId ? Country.findById(countryId).select('nameEn').lean() : null,
    cityId ? City.findById(cityId).select('nameEn countryId').lean() : null,
    subCityId ? SubCity.findById(subCityId).select('nameEn cityId').lean() : null,
  ]);

  if (countryId && !country) {
    return { error: 'Invalid countryId' };
  }
  if (cityId && !city) {
    return { error: 'Invalid cityId' };
  }
  if (subCityId && !subCity) {
    return { error: 'Invalid subCityId' };
  }

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

const clearDefaultFor = (userId) =>
  Address.updateMany({ user: userId, isDefault: true }, { $set: { isDefault: false } });

const isDuplicateKeyError = (err) => err && err.code === 11000;

export const getAddresses = async (req, res) => {
  try {
    const addresses = await Address.find({ user: req.appUser._id })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean();

    return res.status(200).json(addresses);
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
    const data = pickAllowed(req.body);

    if (data.countryId || data.cityId || data.subCityId) {
      const result = await resolveLocation(data);
      if (result.error) {
        return res.status(400).json({ message: result.error });
      }
      Object.assign(data, result.names);
    }

    if (data.isDefault) {
      await clearDefaultFor(userId);
    }

    const address = await Address.create({ ...data, user: userId });
    return res.status(201).json(address);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      try {
        await clearDefaultFor(userId);
        const data = pickAllowed(req.body);
        const address = await Address.create({ ...data, user: userId });
        return res.status(201).json(address);
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
    const data = pickAllowed(req.body);

    if (data.countryId || data.cityId || data.subCityId) {
      const result = await resolveLocation(data);
      if (result.error) {
        return res.status(400).json({ message: result.error });
      }
      Object.assign(data, result.names);
    }

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

    return res.status(200).json(address);
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

    return res.status(200).json(address);
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
