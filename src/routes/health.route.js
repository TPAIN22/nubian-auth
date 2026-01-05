import express from 'express';
import mongoose from 'mongoose';
import logger from '../lib/logger.js';

const router = express.Router();

/**
 * Health check endpoint
 * Returns 200 if the service is running
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

/**
 * Readiness check endpoint
 * Returns 200 if the service is ready to accept traffic
 * Returns 503 if database is not connected
 */
router.get('/ready', async (req, res) => {
  try {
    // Check database connection
    const dbState = mongoose.connection.readyState;
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    
    if (dbState !== 1) {
      logger.warn('Readiness check failed: Database not connected', {
        dbState,
        requestId: req.requestId,
      });
      return res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
      });
    }

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    logger.error('Readiness check error', {
      requestId: req.requestId,
      error: error.message,
    });
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: 'Service unavailable',
    });
  }
});

export default router;

