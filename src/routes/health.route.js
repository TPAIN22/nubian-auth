import express from 'express';
import mongoose from 'mongoose';
import logger from '../lib/logger.js';

const router = express.Router();

// Liveness probe — returns 200 if the process is alive
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness probe — returns 503 if the database is not connected
// Does NOT expose DB host, DB name, memory, CPU, or Node version
router.get('/ready', async (req, res) => {
  try {
    const connected = mongoose.connection.readyState === 1;
    if (!connected) {
      logger.warn('Readiness check failed: database not connected', { requestId: req.requestId });
      return res.status(503).json({ status: 'not ready', timestamp: new Date().toISOString() });
    }
    res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Readiness check error', { requestId: req.requestId, error: error.message });
    res.status(503).json({ status: 'not ready', timestamp: new Date().toISOString() });
  }
});

// Kubernetes liveness probe alias
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

export default router;
