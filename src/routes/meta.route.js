import { Router } from "express";
import {
  getActiveCountries,
  getActiveCurrencies,
  getMetaData,
} from "../controllers/meta.controller.js";

const router = Router();

/**
 * Public metadata routes for currency system
 * These endpoints are used by the mobile app for initialization
 */

// GET /meta/countries - Get active countries with their default currencies
router.get("/countries", getActiveCountries);

// GET /meta/currencies - Get active currencies with their config
router.get("/currencies", getActiveCurrencies);

// GET /meta/all - Get both countries and currencies in one call
router.get("/all", getMetaData);

export default router;
