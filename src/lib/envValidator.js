import logger from './logger.js';

/**
 * Required environment variables
 */
const requiredEnvVars = {
  MONGODB_URI: process.env.MONGODB_URI,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
};

/**
 * Validate that all required environment variables are present
 * @throws {Error} If any required environment variable is missing
 */
export const validateEnv = () => {
  const missing = [];

  for (const [key, value] of Object.entries(requiredEnvVars)) {
    if (!value || value.trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const errorMessage = `Missing required environment variables: ${missing.join(', ')}\nPlease check your .env file and ensure all required variables are set.`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  logger.info('Environment variables validated successfully');
};

