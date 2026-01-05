import express from 'express';
import mongoose from 'mongoose';
import logger from '../lib/logger.js';
import os from 'os';

const router = express.Router();

/**
 * Health check endpoint
 * Returns 200 if the service is running
 * Used by load balancers and monitoring systems
 */
router.get('/health', (req, res) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    uptimeFormatted: formatUptime(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    nodeVersion: process.version,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      unit: 'MB',
    },
    cpu: {
      loadAverage: os.loadavg(),
      cores: os.cpus().length,
    },
  };

  logger.debug('Health check', {
    requestId: req.requestId,
    ...healthData,
  });

  res.status(200).json(healthData);
});

/**
 * Readiness check endpoint
 * Returns 200 if the service is ready to accept traffic
 * Returns 503 if database is not connected
 * Used by Kubernetes readiness probes
 */
router.get('/ready', async (req, res) => {
  try {
    // Check database connection
    const dbState = mongoose.connection.readyState;
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    
    const dbStateNames = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };

    if (dbState !== 1) {
      logger.warn('Readiness check failed: Database not connected', {
        dbState: dbStateNames[dbState] || dbState,
        requestId: req.requestId,
      });
      return res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        database: {
          state: dbStateNames[dbState] || dbState,
          connected: false,
        },
        message: 'Database is not connected',
      });
    }

    // Additional checks can be added here (e.g., external services, cache)
    const readinessData = {
      status: 'ready',
      timestamp: new Date().toISOString(),
      database: {
        state: 'connected',
        connected: true,
        host: mongoose.connection.host,
        name: mongoose.connection.name,
      },
      services: {
        database: 'ok',
      },
    };

    logger.debug('Readiness check passed', {
      requestId: req.requestId,
      ...readinessData,
    });

    res.status(200).json(readinessData);
  } catch (error) {
    logger.error('Readiness check error', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: 'Service unavailable',
      message: error.message,
    });
  }
});

/**
 * Liveness check endpoint
 * Returns 200 if the service is alive
 * Used by Kubernetes liveness probes
 */
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * Helper function to format uptime
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

export default router;

