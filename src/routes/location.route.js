import express from 'express';
import {
  // Countries
  getCountries,
  createCountry,
  updateCountry,
  deleteCountry,
  // Cities
  getCitiesByCountry,
  createCity,
  updateCity,
  deleteCity,
  // SubCities
  getSubCitiesByCity,
  createSubCity,
  updateSubCity,
  deleteSubCity
} from '../controllers/location.controller.js';

import {
  validateCountry,
  validateCountryUpdate,
  validateCity,
  validateCityUpdate,
  validateSubCity,
  validateSubCityUpdate,
  validateCountryId,
  validateCityId,
  validateSubCityId,
  validateIdParam,
  validateActiveQuery
} from '../middleware/validators/location.validator.js';

import { handleValidationErrors } from '../middleware/validation.middleware.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

// ========== PUBLIC ENDPOINTS (for mobile app) ==========

// Countries
router.get('/countries', validateActiveQuery, handleValidationErrors, getCountries);

// Cities by country
router.get('/countries/:countryId/cities',
  validateCountryId,
  validateActiveQuery,
  handleValidationErrors,
  getCitiesByCountry
);

// All cities (for admin interface)
router.get('/cities',
  getCitiesByCountry
);

// SubCities by city
router.get('/cities/:cityId/subcities',
  validateCityId,
  validateActiveQuery,
  handleValidationErrors,
  getSubCitiesByCity
);

// All subcities (for admin interface)
router.get('/subcities',
  getSubCitiesByCity
);

// ========== ADMIN ENDPOINTS (for dashboard) ==========

// Countries CRUD
router.post('/countries',
  isAuthenticated,
  isAdmin,
  validateCountry,
  handleValidationErrors,
  createCountry
);

router.put('/countries/:id',
  isAuthenticated, isAdmin,
  validateIdParam, handleValidationErrors,
  updateCountry
);

router.delete('/countries/:id',
  isAuthenticated, isAdmin,
  validateIdParam, handleValidationErrors,
  deleteCountry
);

// Cities CRUD
router.post('/countries/:countryId/cities',
  isAuthenticated,
  isAdmin,
  validateCountryId,
  validateCity,
  handleValidationErrors,
  createCity
);

router.put('/cities/:id',
  isAuthenticated, isAdmin,
  validateIdParam, handleValidationErrors,
  updateCity
);

router.delete('/cities/:id',
  isAuthenticated, isAdmin,
  validateIdParam, handleValidationErrors,
  deleteCity
);

// SubCities CRUD
router.post('/cities/:cityId/subcities',
  isAuthenticated,
  isAdmin,
  validateCityId,
  validateSubCity,
  handleValidationErrors,
  createSubCity
);

router.put('/subcities/:id',
  isAuthenticated, isAdmin,
  validateIdParam, handleValidationErrors,
  updateSubCity
);

router.delete('/subcities/:id',
  isAuthenticated, isAdmin,
  validateIdParam, handleValidationErrors,
  deleteSubCity
);

export default router;