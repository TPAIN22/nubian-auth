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
    default: 'http://localhost:3000,http://localhost:3001,https://www.nubian-sd.com,https://nubian-sd.com',
  },
  LOG_LEVEL: {
    value: process.env.LOG_LEVEL || 'info',
    description: 'Logging level',
    default: 'info',
  },
  REDIS_URL: {
    value: process.env.REDIS_URL,
    description: 'Redis connection URL (required when ENABLE_QUEUE=true)',
    default: 'redis://localhost:6379',
  },
  REDIS_PREFIX: {
    value: process.env.REDIS_PREFIX || '',
    description: 'Optional Redis key prefix to namespace queues',
    default: '',
  },
  ENABLE_QUEUE: {
    value: process.env.ENABLE_QUEUE || 'false',
    description: 'Enable BullMQ-based notification pipeline',
    default: 'false',
  },
  WORKER_ROLES: {
    value: process.env.WORKER_ROLES || 'push,email,fanout,maintenance',
    description: 'Comma-separated worker roles (push, email, sms, fanout, maintenance, all)',
    default: 'push,email,fanout,maintenance',
  },
  RUN_WORKERS_INPROCESS: {
    value: process.env.RUN_WORKERS_INPROCESS || 'false',
    description: 'Run workers inside the API process (single-dyno deploys)',
    default: 'false',
  },

  // ── Pricing ────────────────────────────────────────────────────────────────
  // Nubian's default margin on top of the merchant price. Single knob for the
  // whole platform — see lib/pricing.config.js.
  NUBIAN_MARKUP: {
    value: process.env.NUBIAN_MARKUP || '30',
    description: "Default Nubian markup %, applied when a variant has no explicit markup",
    default: '30',
  },

  // ── Geo / maps ─────────────────────────────────────────────────────────────
  // All map + geocoding traffic is proxied through /api/geo, so these keys stay
  // server-side. Provider is swappable without touching code — see
  // services/geo/providers/index.js for the per-provider config each key feeds.
  GEO_PROVIDER: {
    value: process.env.GEO_PROVIDER || 'none',
    description: 'Active map/geocoding provider (google, nominatim, none)',
    default: 'none',
  },
  GEO_FALLBACK_PROVIDERS: {
    value: process.env.GEO_FALLBACK_PROVIDERS || '',
    description: 'Comma-separated providers to try when the primary fails',
    default: '',
  },
  GEO_GOOGLE_API_KEY: {
    value: process.env.GEO_GOOGLE_API_KEY,
    description: 'Server-side key for the Google provider (never sent to clients)',
    default: '',
  },
  GEO_DEFAULT_LAT: {
    value: process.env.GEO_DEFAULT_LAT || '15.5007',
    description: 'Map centre latitude when the device has no fix (default: Khartoum)',
    default: '15.5007',
  },
  GEO_DEFAULT_LNG: {
    value: process.env.GEO_DEFAULT_LNG || '32.5599',
    description: 'Map centre longitude when the device has no fix (default: Khartoum)',
    default: '32.5599',
  },
  GEO_COUNTRY_CODES: {
    value: process.env.GEO_COUNTRY_CODES || '',
    description: 'Comma-separated ISO country codes to bias/restrict search (e.g. sd,sa,ae)',
    default: '',
  },
  GEO_TILE_URL: {
    value: process.env.GEO_TILE_URL || '',
    description: 'Raster tile template handed to clients for non-SDK map rendering',
    default: '',
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
    REDIS_URL: (val) => val.startsWith('redis://') || val.startsWith('rediss://'),
    ENABLE_QUEUE: (val) => ['true', 'false'].includes(val),
    RUN_WORKERS_INPROCESS: (val) => ['true', 'false'].includes(val),
  };
  // Note: only *required* vars are format-checked here. NUBIAN_MARKUP validates
  // itself in lib/pricing.config.js (warn + fall back to 30, never fatal — a
  // typo'd margin shouldn't take the API down). Geo config is validated
  // at first use by GeoService, which logs and falls through to the next
  // provider rather than taking the process down over a map key.

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

  // Conditional requirement: REDIS_URL is mandatory when the queue is enabled
  if (process.env.ENABLE_QUEUE === 'true' && !process.env.REDIS_URL) {
    missing.push({
      key: 'REDIS_URL',
      description: 'Redis connection URL (required when ENABLE_QUEUE=true)',
      example: 'redis://localhost:6379',
    });
  }

  // Queue enabled but no consumer configured in this process. Not fatal — a
  // separate `npm run worker` dyno is a valid topology — but if that dyno also
  // isn't running, producers enqueue into a queue nothing ever drains and every
  // notification silently parks in BullMQ 'waiting'. Say so loudly at boot.
  if (process.env.ENABLE_QUEUE === 'true' && process.env.RUN_WORKERS_INPROCESS !== 'true') {
    logger.warn(
      'ENABLE_QUEUE=true but RUN_WORKERS_INPROCESS is not true — this process will ' +
        'enqueue notifications without consuming them. Confirm a separate worker ' +
        '(npm run worker) is running, or set RUN_WORKERS_INPROCESS=true.'
    );
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

