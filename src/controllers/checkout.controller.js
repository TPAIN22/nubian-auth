import orderService from '../services/order.service.js';
import { ServiceError } from '../lib/errors.js';
import { sendSuccess, sendError } from '../lib/response.js';
import logger from '../lib/logger.js';

export const quoteCheckout = async (req, res) => {
  try {
    const { addressId, items } = req.body || {};

    if (!addressId) {
      return sendError(res, {
        message: 'addressId is required',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        details: [{ field: 'addressId', message: 'Required' }],
      });
    }

    const quote = await orderService.quoteOrder(
      req.appUser,
      addressId,
      items,
      req.currencyCode || 'USD',
    );

    return sendSuccess(res, { data: quote });
  } catch (err) {
    if (err instanceof ServiceError) {
      return sendError(res, {
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
        details: err.details,
      });
    }
    logger.error('quoteCheckout failed', {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    return sendError(res, {
      message: 'Failed to compute checkout quote',
      code: 'QUOTE_FAILED',
      statusCode: 500,
    });
  }
};
