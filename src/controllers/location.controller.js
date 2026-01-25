import Country from '../models/country.model.js';
import City from '../models/city.model.js';
import SubCity from '../models/subcity.model.js';
import { sendSuccess, sendError, sendPaginated } from '../lib/response.js';

// ========== COUNTRY CONTROLLERS ==========

// Get all countries (public - for app)
export const getCountries = async (req, res) => {
  try {
    const { active } = req.query;
    const filter = active !== undefined ? { isActive: active } : {};

    const countries = await Country.find(filter)
      .sort({ sortOrder: 1, nameEn: 1 })
      .select('_id code nameAr nameEn isActive sortOrder');

    sendSuccess(res, {
      data: countries,
      message: 'Countries retrieved successfully'
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to retrieve countries',
      code: 'COUNTRIES_RETRIEVE_ERROR'
    });
  }
};

// Create country (admin only)
export const createCountry = async (req, res) => {
  try {
    const { code, nameAr, nameEn, isActive, sortOrder } = req.body;

    // Check if country code already exists
    const existingCountry = await Country.findOne({ code });
    if (existingCountry) {
      return sendError(res, {
        message: 'Country with this code already exists',
        code: 'COUNTRY_CODE_EXISTS',
        statusCode: 409
      });
    }

    const country = await Country.create({
      code,
      nameAr,
      nameEn,
      isActive,
      sortOrder
    });

    sendSuccess(res, {
      data: country,
      message: 'Country created successfully',
      statusCode: 201
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to create country',
      code: 'COUNTRY_CREATE_ERROR'
    });
  }
};

// Update country (admin only)
export const updateCountry = async (req, res) => {
  try {
    const { id } = req.params;
    const { code, nameAr, nameEn, isActive, sortOrder } = req.body;

    // Check if updating code and it already exists for another country
    if (code) {
      const existingCountry = await Country.findOne({ code, _id: { $ne: id } });
      if (existingCountry) {
        return sendError(res, {
          message: 'Country with this code already exists',
          code: 'COUNTRY_CODE_EXISTS',
          statusCode: 409
        });
      }
    }

    const country = await Country.findByIdAndUpdate(
      id,
      { code, nameAr, nameEn, isActive, sortOrder },
      { new: true }
    );

    if (!country) {
      return sendError(res, {
        message: 'Country not found',
        code: 'COUNTRY_NOT_FOUND',
        statusCode: 404
      });
    }

    sendSuccess(res, {
      data: country,
      message: 'Country updated successfully'
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to update country',
      code: 'COUNTRY_UPDATE_ERROR'
    });
  }
};

// Delete country (admin only)
export const deleteCountry = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if country has active cities
    const activeCities = await City.countDocuments({ countryId: id, isActive: true });
    if (activeCities > 0) {
      return sendError(res, {
        message: 'Cannot delete country with active cities',
        code: 'COUNTRY_HAS_ACTIVE_CITIES',
        statusCode: 409
      });
    }

    const country = await Country.findByIdAndDelete(
      id
    );

    if (!country) {
      return sendError(res, {
        message: 'Country not found',
        code: 'COUNTRY_NOT_FOUND',
        statusCode: 404
      });
    }

    sendSuccess(res, {
      data: country,
      message: 'Country deleted successfully'
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to delete country',
      code: 'COUNTRY_DELETE_ERROR'
    });
  }
};

// ========== CITY CONTROLLERS ==========

// Get cities by country (public - for app)
export const getCitiesByCountry = async (req, res) => {
  try {
    const { countryId } = req.params;
    const { active } = req.query;

    let filter = {};
    if (countryId && countryId !== 'all') {
      filter.countryId = countryId;
    }
    if (active !== undefined) {
      filter.isActive = active;
    }

    const cities = await City.find(filter)
      .sort({ sortOrder: 1, nameEn: 1 })
      .select('_id countryId nameAr nameEn isActive sortOrder');

    sendSuccess(res, {
      data: cities,
      message: 'Cities retrieved successfully'
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to retrieve cities',
      code: 'CITIES_RETRIEVE_ERROR'
    });
  }
};

// Create city (admin only)
export const createCity = async (req, res) => {
  try {
    const { countryId } = req.params;
    const { nameAr, nameEn, isActive, sortOrder } = req.body;

    // Verify country exists
    const country = await Country.findById(countryId);
    if (!country) {
      return sendError(res, {
        message: 'Country not found',
        code: 'COUNTRY_NOT_FOUND',
        statusCode: 404
      });
    }

    const city = await City.create({
      countryId,
      nameAr,
      nameEn,
      isActive,
      sortOrder
    });

    sendSuccess(res, {
      data: city,
      message: 'City created successfully',
      statusCode: 201
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to create city',
      code: 'CITY_CREATE_ERROR'
    });
  }
};

// Update city (admin only)
export const updateCity = async (req, res) => {
  try {
    const { id } = req.params;
    const { nameAr, nameEn, isActive, sortOrder } = req.body;

    const city = await City.findByIdAndUpdate(
      id,
      { nameAr, nameEn, isActive, sortOrder },
      { new: true }
    );

    if (!city) {
      return sendError(res, {
        message: 'City not found',
        code: 'CITY_NOT_FOUND',
        statusCode: 404
      });
    }

    sendSuccess(res, {
      data: city,
      message: 'City updated successfully'
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to update city',
      code: 'CITY_UPDATE_ERROR'
    });
  }
};

// Delete city (admin only)
export const deleteCity = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if city has active subcities
    const activeSubCities = await SubCity.countDocuments({ cityId: id, isActive: true });
    if (activeSubCities > 0) {
      return sendError(res, {
        message: 'Cannot delete city with active subcities',
        code: 'CITY_HAS_ACTIVE_SUBCITIES',
        statusCode: 409
      });
    }

    const city = await City.findByIdAndDelete(
      id
    );

    if (!city) {
      return sendError(res, {
        message: 'City not found',
        code: 'CITY_NOT_FOUND',
        statusCode: 404
      });
    }

    sendSuccess(res, {
      data: city,
      message: 'City deleted successfully'
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to delete city',
      code: 'CITY_DELETE_ERROR'
    });
  }
};

// ========== SUBCITY CONTROLLERS ==========

// Get subcities by city (public - for app)
export const getSubCitiesByCity = async (req, res) => {
  try {
    const { cityId } = req.params;
    const { active } = req.query;

    let filter = {};
    if (cityId && cityId !== 'all') {
      filter.cityId = cityId;
    }
    if (active !== undefined) {
      filter.isActive = active;
    }

    const subCities = await SubCity.find(filter)
      .sort({ sortOrder: 1, nameEn: 1 })
      .select('_id cityId nameAr nameEn isActive sortOrder');

    sendSuccess(res, {
      data: subCities,
      message: 'SubCities retrieved successfully'
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to retrieve subcities',
      code: 'SUBCITIES_RETRIEVE_ERROR'
    });
  }
};

// Create subcity (admin only)
export const createSubCity = async (req, res) => {
  try {
    const { cityId } = req.params;
    const { nameAr, nameEn, isActive, sortOrder } = req.body;

    // Verify city exists
    const city = await City.findById(cityId);
    if (!city) {
      return sendError(res, {
        message: 'City not found',
        code: 'CITY_NOT_FOUND',
        statusCode: 404
      });
    }

    const subCity = await SubCity.create({
      cityId,
      nameAr,
      nameEn,
      isActive,
      sortOrder
    });

    sendSuccess(res, {
      data: subCity,
      message: 'SubCity created successfully',
      statusCode: 201
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to create subcity',
      code: 'SUBCITY_CREATE_ERROR'
    });
  }
};

// Update subcity (admin only)
export const updateSubCity = async (req, res) => {
  try {
    const { id } = req.params;
    const { nameAr, nameEn, isActive, sortOrder } = req.body;

    const subCity = await SubCity.findByIdAndUpdate(
      id,
      { nameAr, nameEn, isActive, sortOrder },
      { new: true }
    );

    if (!subCity) {
      return sendError(res, {
        message: 'SubCity not found',
        code: 'SUBCITY_NOT_FOUND',
        statusCode: 404
      });
    }

    sendSuccess(res, {
      data: subCity,
      message: 'SubCity updated successfully'
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to update subcity',
      code: 'SUBCITY_UPDATE_ERROR'
    });
  }
};

// Delete subcity ( admin only)
export const deleteSubCity = async (req, res) => {
  try {
    const { id } = req.params;

    const subCity = await SubCity.findByIdAndDelete(
      id
    );

    if (!subCity) {
      return sendError(res, {
        message: 'SubCity not found',
        code: 'SUBCITY_NOT_FOUND',
        statusCode: 404
      });
    }

    sendSuccess(res, {
      data: subCity,
      message: 'SubCity deleted successfully'
    });
  } catch (error) {
    sendError(res, {
      message: 'Failed to delete subcity',
      code: 'SUBCITY_DELETE_ERROR'
    });
  }
};