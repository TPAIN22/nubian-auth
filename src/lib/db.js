import mongoose from 'mongoose';
import logger from './logger.js';

const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

// Track if event listeners have been registered to prevent duplicates
let eventListenersRegistered = false;

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
    logger.error('MongoDB connection error', { error: err.message });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });

  // Handle process termination (only register once)
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed due to app termination');
    process.exit(0);
  });

  eventListenersRegistered = true;
};

/**
 * Connect to MongoDB with retry logic and connection pooling
 */
export const connect = async (retries = MAX_RETRIES) => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    const options = {
      // Connection pool settings
      maxPoolSize: 10, // Maintain up to 10 socket connections
      minPoolSize: 2, // Maintain at least 2 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      family: 4, // Use IPv4, skip trying IPv6
      // Retry settings
      retryWrites: true,
      retryReads: true,
    };

    await mongoose.connect(mongoUri, options);
    
    logger.info('MongoDB connected successfully', {
      host: mongoose.connection.host,
      database: mongoose.connection.name,
    });

    // Register event listeners only once (before first successful connection)
    registerEventListeners();

  } catch (error) {
    logger.error('MongoDB connection failed', {
      error: error.message,
      retriesLeft: retries - 1,
    });

    if (retries > 1) {
      logger.info(`Retrying connection in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return connect(retries - 1);
    }

    throw new Error(`Failed to connect to database after ${MAX_RETRIES} attempts: ${error.message}`);
  }
}; 