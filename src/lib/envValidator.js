import logger from './logger.js';

/**
 * Required environment variables with descriptions
 */
const requiredEnvVars = {
  MONGODB_URI: {
    value: process.env.MONGODB_URI,
    description: 'MongoDB connection string',
    example: 'mongodb://localhost:27017/nubian',
  },
  CLERK_SECRET_KEY: {
    value: process.env.CLERK_SECRET_KEY,
    description: 'Clerk authentication secret key',
    example: 'sk_test_...',
  },
  CLERK_WEBHOOK_SECRET: {
    value: process.env.CLERK_WEBHOOK_SECRET,
    description: 'Clerk webhook secret for signature verification',
    example: 'whsec_...',
  },
  RESEND_API_KEY: {
    value: process.env.RESEND_API_KEY,
    description: 'Resend API key for email sending',
    example: 're_...',
  },
};

/**
 * Optional environment variables with defaults
 */
const optionalEnvVars = {
  PORT: {
    value: process.env.PORT || '5000',
    description: 'Server port',
    default: '5000',
  },
  NODE_ENV: {
    value: process.env.NODE_ENV || 'development',
    description: 'Node environment',
    default: 'development',
  },
  CORS_ORIGINS: {
    value: process.env.CORS_ORIGINS,
    description: 'Comma-separated list of allowed CORS origins',
    default: 'http://localhost:3000,http://localhost:3001,https://www.nubian-sd.store,https://nubian-sd.store',
  },
  LOG_LEVEL: {
    value: process.env.LOG_LEVEL || 'info',
    description: 'Logging level',
    default: 'info',
  },
};

/**
 * Validate environment variable format
 */
const validateFormat = (key, value) => {
  const validations = {
    MONGODB_URI: (val) => val.startsWith('mongodb://') || val.startsWith('mongodb+srv://'),
    CLERK_SECRET_KEY: (val) => val.startsWith('sk_') || val.startsWith('sk_test_') || val.startsWith('sk_live_'),
    CLERK_WEBHOOK_SECRET: (val) => val.startsWith('whsec_'),
    RESEND_API_KEY: (val) => val.startsWith('re_'),
    PORT: (val) => !isNaN(parseInt(val)) && parseInt(val) > 0 && parseInt(val) < 65536,
    NODE_ENV: (val) => ['development', 'production', 'test'].includes(val),
    LOG_LEVEL: (val) => ['error', 'warn', 'info', 'debug'].includes(val),
  };

  if (validations[key]) {
    return validations[key](value);
  }
  return true; // No validation for this key
};

/**
 * Validate that all required environment variables are present
 * @throws {Error} If any required environment variable is missing or invalid
 */
export const validateEnv = () => {
  const missing = [];
  const invalid = [];

  // Check required variables
  for (const [key, config] of Object.entries(requiredEnvVars)) {
    const value = config.value;
    
    if (!value || value.trim() === '') {
      missing.push({
        key,
        description: config.description,
        example: config.example,
      });
    } else if (!validateFormat(key, value)) {
      invalid.push({
        key,
        description: config.description,
        value: value.substring(0, 10) + '...', // Show first 10 chars only
        example: config.example,
      });
    }
  }

  // Build error message
  let errorMessage = '';

  if (missing.length > 0) {
    errorMessage += 'Missing required environment variables:\n';
    missing.forEach(({ key, description, example }) => {
      errorMessage += `  - ${key}: ${description}\n`;
      errorMessage += `    Example: ${example}\n`;
    });
    errorMessage += '\nPlease check your .env file and ensure all required variables are set.\n';
    errorMessage += 'See .env.example for reference.\n';
  }

  if (invalid.length > 0) {
    errorMessage += '\nInvalid environment variable format:\n';
    invalid.forEach(({ key, description, value, example }) => {
      errorMessage += `  - ${key}: ${description}\n`;
      errorMessage += `    Current value: ${value}\n`;
      errorMessage += `    Expected format: ${example}\n`;
    });
  }

  if (errorMessage) {
    logger.error('Environment validation failed', {
      missing: missing.map(m => m.key),
      invalid: invalid.map(i => i.key),
    });
    throw new Error(errorMessage);
  }

  // Log optional variables being used
  const usedOptional = [];
  for (const [key, config] of Object.entries(optionalEnvVars)) {
    if (process.env[key]) {
      usedOptional.push(key);
    }
  }

  logger.info('Environment variables validated successfully', {
    required: Object.keys(requiredEnvVars),
    optional: usedOptional.length > 0 ? usedOptional : 'using defaults',
    nodeEnv: optionalEnvVars.NODE_ENV.value,
    port: optionalEnvVars.PORT.value,
  });
};

/**
 * Get environment variable value with optional default
 */
export const getEnv = (key, defaultValue = null) => {
  if (requiredEnvVars[key]) {
    return requiredEnvVars[key].value || defaultValue;
  }
  if (optionalEnvVars[key]) {
    return optionalEnvVars[key].value || defaultValue;
  }
  return process.env[key] || defaultValue;
};

