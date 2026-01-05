import mongoose from 'mongoose';
import logger from './logger.js';

const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds
const INITIAL_RETRY_DELAY = 1000; // Start with 1 second, exponential backoff

// Track if event listeners have been registered to prevent duplicates
let eventListenersRegistered = false;
let connectionAttempts = 0;
let lastConnectionTime = null;

/**
 * Register MongoDB connection event listeners
 * This function is idempotent - it only registers listeners once
 */
const registerEventListeners = () => {
  if (eventListenersRegistered) {
    return; // Already registered, skip
  }

  // Handle connection events
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { 
      error: err.message,
      name: err.name,
      code: err.code,
    });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected', {
      readyState: mongoose.connection.readyState,
    });
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected', {
      host: mongoose.connection.host,
      database: mongoose.connection.name,
    });
  });

  mongoose.connection.on('connecting', () => {
    logger.info('MongoDB connecting...', {
      host: mongoose.connection.host,
    });
  });

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected', {
      host: mongoose.connection.host,
      database: mongoose.connection.name,
      readyState: mongoose.connection.readyState,
    });
    lastConnectionTime = Date.now();
    connectionAttempts = 0;
  });

  // Monitor connection pool
  mongoose.connection.on('fullsetup', () => {
    logger.debug('MongoDB connection pool fully set up');
  });

  // Handle process termination gracefully
  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, closing MongoDB connection...`);
    try {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed gracefully');
      process.exit(0);
    } catch (error) {
      logger.error('Error closing MongoDB connection', { error: error.message });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  eventListenersRegistered = true;
};

/**
 * Connect to MongoDB with retry logic and connection pooling
 * Uses exponential backoff for retries
 */
export const connect = async (retries = MAX_RETRIES) => {
  connectionAttempts++;
  const attemptNumber = MAX_RETRIES - retries + 1;
  
  try {
    const mongoUri = process.env.MONGODB_URI;
    
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    // Validate MongoDB URI format
    if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
      throw new Error('Invalid MongoDB URI format. Must start with mongodb:// or mongodb+srv://');
    }

    const options = {
      // Connection pool settings
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10, // Maintain up to 10 socket connections
      minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE) || 2, // Maintain at least 2 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      connectTimeoutMS: 10000, // How long to wait for initial connection
      family: 4, // Use IPv4, skip trying IPv6
      // Retry settings
      retryWrites: true,
      retryReads: true,
      // Heartbeat settings
      heartbeatFrequencyMS: 10000, // Check server status every 10 seconds
      // Buffer settings
      bufferMaxEntries: 0, // Disable mongoose buffering; throw immediately if not connected
      bufferCommands: false, // Disable mongoose buffering
    };

    logger.info('Attempting MongoDB connection', {
      attempt: attemptNumber,
      maxRetries: MAX_RETRIES,
      host: mongoUri.split('@')[1]?.split('/')[0] || 'hidden', // Don't log full URI with credentials
    });

    await mongoose.connect(mongoUri, options);
    
    logger.info('MongoDB connected successfully', {
      host: mongoose.connection.host,
      database: mongoose.connection.name,
      readyState: mongoose.connection.readyState,
      poolSize: {
        max: options.maxPoolSize,
        min: options.minPoolSize,
      },
    });

    // Register event listeners only once (before first successful connection)
    registerEventListeners();

    // Verify connection is actually working
    await mongoose.connection.db.admin().ping();
    logger.info('MongoDB connection verified with ping');

  } catch (error) {
    const retriesLeft = retries - 1;
    const isLastAttempt = retriesLeft === 0;
    
    logger.error('MongoDB connection failed', {
      error: error.message,
      name: error.name,
      code: error.code,
      attempt: attemptNumber,
      retriesLeft,
      isLastAttempt,
    });

    if (retriesLeft > 0) {
      // Exponential backoff: delay increases with each retry
      const delay = Math.min(
        INITIAL_RETRY_DELAY * Math.pow(2, attemptNumber - 1),
        RETRY_DELAY
      );
      
      logger.info(`Retrying MongoDB connection in ${delay / 1000} seconds...`, {
        attempt: attemptNumber + 1,
        retriesLeft,
        delay: `${delay}ms`,
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return connect(retriesLeft);
    }

    // Last attempt failed
    const errorMessage = `Failed to connect to database after ${MAX_RETRIES} attempts: ${error.message}`;
    logger.error(errorMessage, {
      totalAttempts: connectionAttempts,
      lastError: {
        message: error.message,
        name: error.name,
        code: error.code,
      },
    });
    
    throw new Error(errorMessage);
  }
};

/**
 * Get database connection status
 */
export const getConnectionStatus = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  return {
    readyState: mongoose.connection.readyState,
    state: states[mongoose.connection.readyState] || 'unknown',
    host: mongoose.connection.host,
    database: mongoose.connection.name,
    isConnected: mongoose.connection.readyState === 1,
  };
};

/**
 * Close database connection gracefully
 */
export const disconnect = async () => {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  } catch (error) {
    logger.error('Error closing MongoDB connection', { error: error.message });
    throw error;
  }
}; 