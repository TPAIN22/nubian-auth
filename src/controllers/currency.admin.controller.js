import { sendSuccess, sendError, sendNotFound } from '../lib/response.js';
import Currency from '../models/currency.model.js';
import ExchangeRate from '../models/exchangeRate.model.js';
import { getLatestRate } from '../services/fx.service.js';
import logger from '../lib/logger.js';

/**
 * GET /api/admin/currencies
 * List all currencies with their current rates and config.
 */
export const listAllCurrencies = async (req, res) => {
  try {
    const currencies = await Currency.find({})
      .sort({ sortOrder: 1, code: 1 })
      .lean();

    // Attach current rate to each currency
    const withRates = await Promise.all(
      currencies.map(async (c) => {
        if (c.code === 'USD') return { ...c, currentRate: 1, rateSource: 'system' };
        if (c.allowManualRate && c.manualRate > 0) {
          return { ...c, currentRate: c.manualRate, rateSource: 'manual' };
        }
        const rateInfo = await getLatestRate(c.code);
        return {
          ...c,
          currentRate: rateInfo.rate,
          rateSource: rateInfo.provider,
          rateDate: rateInfo.date,
          rateUnavailable: rateInfo.rateUnavailable,
        };
      })
    );

    return sendSuccess(res, {
      data: withRates,
      message: 'Currencies retrieved successfully',
    });
  } catch (error) {
    logger.error('Failed to list currencies', { error: error.message });
    return sendError(res, { message: 'Failed to list currencies', statusCode: 500 });
  }
};

/**
 * PATCH /api/admin/currencies/:code/manual-rate
 * Update the manual exchange rate for a currency (e.g. SDG).
 * Body: { manualRate: 650, allowManualRate: true }
 */
export const updateManualRate = async (req, res) => {
  try {
    const code = req.params.code?.toUpperCase();
    const { manualRate, allowManualRate } = req.body;

    if (!code) return sendError(res, { message: 'Currency code required', statusCode: 400 });

    const currency = await Currency.findOne({ code });
    if (!currency) return sendNotFound(res, `Currency ${code}`);

    const update = { manualRateUpdatedAt: new Date() };

    if (manualRate !== undefined) {
      if (typeof manualRate !== 'number' || manualRate <= 0) {
        return sendError(res, { message: 'manualRate must be a positive number', statusCode: 400 });
      }
      update.manualRate = manualRate;
      update.allowManualRate = true; // auto-enable when rate is set
    }

    if (allowManualRate !== undefined) {
      update.allowManualRate = Boolean(allowManualRate);
    }

    const updated = await Currency.findOneAndUpdate({ code }, { $set: update }, { new: true });

    logger.info('Manual currency rate updated', {
      code,
      manualRate: updated.manualRate,
      allowManualRate: updated.allowManualRate,
      updatedBy: req.auth?.userId,
    });

    return sendSuccess(res, {
      data: updated,
      message: `Manual rate for ${code} updated to ${updated.manualRate}`,
    });
  } catch (error) {
    logger.error('Failed to update manual rate', { error: error.message });
    return sendError(res, { message: 'Failed to update manual rate', statusCode: 500 });
  }
};

/**
 * PATCH /api/admin/currencies/:code/toggle
 * Enable or disable a currency.
 * Body: { isActive: true }
 */
export const toggleCurrencyActive = async (req, res) => {
  try {
    const code = req.params.code?.toUpperCase();
    const { isActive } = req.body;

    if (!code) return sendError(res, { message: 'Currency code required', statusCode: 400 });
    if (typeof isActive !== 'boolean') {
      return sendError(res, { message: 'isActive must be a boolean', statusCode: 400 });
    }
    if (code === 'USD') {
      return sendError(res, { message: 'USD cannot be disabled', statusCode: 400 });
    }

    const updated = await Currency.findOneAndUpdate(
      { code },
      { $set: { isActive } },
      { new: true }
    );

    if (!updated) return sendNotFound(res, `Currency ${code}`);

    logger.info('Currency active status toggled', {
      code,
      isActive,
      updatedBy: req.auth?.userId,
    });

    return sendSuccess(res, {
      data: updated,
      message: `${code} is now ${isActive ? 'active' : 'inactive'}`,
    });
  } catch (error) {
    logger.error('Failed to toggle currency', { error: error.message });
    return sendError(res, { message: 'Failed to toggle currency', statusCode: 500 });
  }
};

/**
 * GET /api/admin/currencies/rates
 * Show latest exchange rate document from DB.
 */
export const getExchangeRateStatus = async (req, res) => {
  try {
    const latest = await ExchangeRate.getLatest();

    if (!latest) {
      return sendSuccess(res, {
        data: {
          hasRates: false,
          message: 'No exchange rates in DB. POST /api/fx/refresh to fetch now.',
        },
        message: 'No exchange rates found',
      });
    }

    const rates = latest.rates instanceof Map
      ? Object.fromEntries(latest.rates)
      : latest.rates;

    const ageHours = ((Date.now() - new Date(latest.fetchedAt).getTime()) / 3600000).toFixed(1);

    return sendSuccess(res, {
      data: {
        hasRates: true,
        base: latest.base,
        date: latest.date,
        fetchedAt: latest.fetchedAt,
        ageHours: parseFloat(ageHours),
        provider: latest.provider,
        fetchStatus: latest.fetchStatus,
        missingCurrencies: latest.missingCurrencies,
        rates,
      },
      message: 'Exchange rate status retrieved',
    });
  } catch (error) {
    logger.error('Failed to get exchange rate status', { error: error.message });
    return sendError(res, { message: 'Failed to get exchange rates', statusCode: 500 });
  }
};

/**
 * POST /api/admin/currencies
 * Create a new currency.
 */
export const createCurrency = async (req, res) => {
  try {
    const { code, name, nameAr, symbol, symbolPosition, isActive, decimals, roundingStrategy, sortOrder, allowManualRate, manualRate, marketMarkupAdjustment } = req.body;
    
    if (!code || !name || !symbol) {
      return sendError(res, { message: 'Code, name, and symbol are required', statusCode: 400 });
    }

    const existing = await Currency.findOne({ code: code.toUpperCase() });
    if (existing) {
      return sendError(res, { message: 'Currency code already exists', statusCode: 400 });
    }

    const newCurrency = await Currency.create({
      code: code.toUpperCase(),
      name,
      nameAr,
      symbol,
      symbolPosition: symbolPosition || 'before',
      isActive: isActive || false,
      decimals: decimals || 2,
      roundingStrategy: roundingStrategy || 'NONE',
      sortOrder: sortOrder || 0,
      allowManualRate: allowManualRate || false,
      manualRate: manualRate || 0,
      marketMarkupAdjustment: marketMarkupAdjustment || 0
    });

    return sendSuccess(res, { data: newCurrency, message: 'Currency created' });
  } catch (error) {
    logger.error('Failed to create currency', { error: error.message });
    return sendError(res, { message: 'Failed to create currency', statusCode: 500 });
  }
};

/**
 * PUT /api/admin/currencies/:id
 * Update an existing currency.
 */
export const updateCurrency = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    
    if (body.code) body.code = body.code.toUpperCase();

    const updated = await Currency.findByIdAndUpdate(id, { $set: body }, { new: true });
    
    if (!updated) return sendNotFound(res, `Currency ${id}`);

    return sendSuccess(res, { data: updated, message: 'Currency updated' });
  } catch (error) {
    logger.error('Failed to update currency', { error: error.message });
    return sendError(res, { message: 'Failed to update currency', statusCode: 500 });
  }
};
