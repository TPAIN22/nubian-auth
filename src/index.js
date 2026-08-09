import 'dotenv/config'; // Must be first — loads .env before any other module reads process.env
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createLimiter } from './lib/rateLimit/index.js';
import { healthProbeLimiter } from './lib/rateLimit/healthLimiter.js';
import { startBanSync, stopBanSync } from './lib/rateLimit/denylist.js';
import { closeRateLimitRedis } from './lib/rateLimit/redis.js';
import { resolveClientIp } from './middleware/clientIp.middleware.js';
import { ipDenylist } from './middleware/ipDenylist.middleware.js';
import { connect } from './lib/db.js';
import productRoutes from './routes/products.route.js';
import orderRoutes from './routes/orders.route.js';
import cartRoutes from './routes/carts.route.js';
import reviewRoutes from './routes/reviews.route.js';
import categoryRoutes from './routes/categories.route.js';
import userRoutes from './routes/users.route.js';
import webhookRoutes from './routes/webhook.routes.js';
import ticketRoutes from './routes/tickets.route.js';
import disputeRoutes from './routes/disputes.route.js';
import { clerkMiddleware } from '@clerk/express';
import NotificationsRoutes from './routes/notifications.route.js';
import bannerRoutes from './routes/banners.route.js';
import collectionRoutes from './routes/collections.route.js';
import wishlistRoutes from './routes/wishlist.route.js';
import addressRoutes from './routes/address.route.js';
import checkoutRoutes from './routes/checkout.route.js';
import couponRoutes from './routes/coupons.route.js';
import locationRoutes from './routes/location.route.js';
import geoRoutes from './routes/geo.route.js';
import addressAdminRoutes from './routes/address.admin.route.js';
import merchantRoutes from './routes/merchant.route.js';
import homeRoutes from './routes/home.route.js';
import healthRoutes from './routes/health.route.js';
import recommendationsRoutes from './routes/recommendations.route.js';
import trackingRoutes from './routes/tracking.route.js';
import analyticsRoutes from './routes/analytics.route.js';
import uploadRoutes from './routes/upload.route.js';
import metaRoutes from './routes/meta.route.js';
import fxRoutes from './routes/fx.route.js';
import preferencesRoutes from './routes/preferences.route.js';
import currencyAdminRoutes from './routes/currency.admin.route.js';
import marketerAdminRoutes from './routes/marketer.route.js';
import affiliateRoutes from './routes/affiliate.route.js';
import referralTrackingRoutes from './routes/referralTracking.route.js';
import adminCommissionRoutes from './routes/adminCommission.route.js';
import queuesAdminRoutes from './routes/queues.admin.route.js';
import securityAdminRoutes from './routes/security.admin.route.js';
import { requestLogger } from './middleware/logger.middleware.js';
import { currencyMiddleware } from './middleware/currency.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.middleware.js';
import { enforceHTTPS } from './middleware/https.middleware.js';
import logger from './lib/logger.js';
import { validateEnv } from './lib/envValidator.js';

// Validate environment variables on startup
try {
  validateEnv();
} catch (error) {
  logger.error('Environment validation failed', { error: error.message });
  process.exit(1);
}

// Register process-level safety nets early so they cover all async startup code and cron jobs
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception — shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection — shutting down', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});

const app = express();

// Trust exactly 1 proxy hop in production (Render, etc.), none in development.
// Setting this to `true` in dev lets clients spoof X-Forwarded-For and bypass
// rate limiting. Declared up here because everything IP-derived below —
// resolveClientIp, the denylist, every limiter — reads `req.ip`, which this
// setting defines.
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

// Redirect HTTP → HTTPS in production (must be before all other middleware)
app.use(enforceHTTPS);

// 🧩 CORS Configuration - MUST BE FIRST
const BAKED_IN_ORIGINS = [
  'http://192.168.50.83',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://www.nubian-sd.com',
  'https://nubian-sd.com',
];

const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...BAKED_IN_ORIGINS, ...envOrigins]));

logger.info('CORS: Configured for specific origins', { origins: allowedOrigins });

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    logger.warn('CORS: blocked origin', { origin });
    return callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
    'x-currency',
    'x-country',
    'x-token'
  ],
  exposedHeaders: ['Set-Cookie']
}));

// 🛡️ Security: Helmet.js for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable if causing issues with external resources
}));

// 🛡️ Security: Rate limiting
// All limiters are built by createLimiter so they share the Redis-backed store,
// key on the real client IP, and feed the IP denylist. Never call rateLimit()
// directly — see lib/rateLimit/index.js.
const limiter = createLimiter({
  name: 'global',
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300, // 300 requests per 15 min per IP (~20 req/min)
  message: 'Too many requests from this IP, please try again later.',
});

// Strict rate limit for webhook/auth endpoints
const authLimiter = createLimiter({
  name: 'webhooks',
  windowMs: 15 * 60 * 1000,
  limit: 20, // 20 requests per 15 min per IP
  message: 'Too many authentication attempts, please try again later.',
  // Webhook traffic originates from Clerk/Svix, not from users. Banning that
  // source IP would silently break user provisioning platform-wide, so this
  // limiter throttles without ever escalating to a ban.
  countsTowardBan: false,
});

// Resolve the true end-user IP before anything reads or keys off it — the
// request log, the denylist, every limiter, and the fraud engine all consume
// req.clientIp, so this must come first.
app.use(resolveClientIp);

// Request logging middleware (must be befoe routes)
app.use(requestLogger);

// Reject banned IPs before routing, auth, body parsing, or any DB work.
app.use(ipDenylist);

// Global currency and country detection
app.use(currencyMiddleware);

// Health check endpoints (before authentication and body parsing).
// Mounted at '/', so the router matches every request — its own routes carry
// their limiter internally rather than taking one here, which would meter the
// entire app.
app.use('/', healthRoutes);
app.get("/ping", healthProbeLimiter, (_, res) => res.send("pong"));

// ⚠️ IMPORTANT: Webhook routes must be registered BEFORE express.json()
// Webhooks need raw body for signature verification - express.json() consumes the body stream
// Apply stricter rate limiting to authentication-related endpoints
// Webhooks handle authentication events (user.created, user.updated, user.deleted)
app.use('/api/webhooks', authLimiter, express.raw({ type: 'application/json' }), webhookRoutes);

// Apply general rate limiting to all other API routes.
// Placed BEFORE the body parsers so a rejected request never costs us the parse:
// otherwise a flood of 2MB payloads is fully read and deserialized before the
// limiter gets to say no. Webhooks are unaffected — they are mounted above with
// their own limiter and raw parser.
app.use('/api', limiter);

// 🛡️ Security: Request size limits (prevent large payload attacks)
// Register body parsers AFTER webhook routes so webhooks can access raw body
// These parsers will apply to all subsequent routes
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Note: clerkMiddleware should NOT block routes - it just adds auth context
app.use(clerkMiddleware({
  // Clerk will automatically check Authorization header for Bearer tokens
  // This allows both session-based and token-based authentication
  // Mobile apps send tokens in the Authorization: Bearer <token> header
  // The middleware will automatically extract and validate these tokens
}));

// Verbose per-request debug logging (development only)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api', (req, res, next) => {
    logger.debug('Incoming API request', {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      path: req.path,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
    });
    next();
  });
}

// API routes

app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', NotificationsRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/carts', cartRoutes);  // POST /api/carts/add -> router.post("/add", ...)
app.use('/api/orders', orderRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/coupons', couponRoutes);
// Legacy country → city → subcity hierarchy. Kept mounted: existing addresses
// still reference these ids and the dashboard still administers them.
app.use('/api/locations', locationRoutes);
// Map-first geocoding proxy. Vendor-neutral — see services/geo/.
app.use('/api/geo', geoRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/fx', fxRoutes);
app.use('/api/me/preferences', preferencesRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/recommendations', recommendationsRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin/addresses', addressAdminRoutes);
app.use('/api/admin/currencies', currencyAdminRoutes);
app.use('/api/admin/marketers', marketerAdminRoutes);
app.use('/api/affiliate', affiliateRoutes);
app.use('/api/track', referralTrackingRoutes);
app.use('/api/admin/commissions', adminCommissionRoutes);
app.use('/api/admin/queues', queuesAdminRoutes);
app.use('/api/admin/security', securityAdminRoutes);

// Debug: Log all unmatched routes before 404 handler
app.use((req, res, next) => {
  // Only log if it's an API route that didn't match
  if (req.path.startsWith('/api/')) {
    logger.warn('API route not matched - will return 404', {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      path: req.path,
      baseUrl: req.baseUrl,
    });
  }
  next();
});

// 404 handler (must be before error handler)
app.use(notFoundHandler);

// Error handler middleware (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Start server only after database connection is established
(async () => {
  try {
    // Connect to database first
    await connect();

    // Prime the IP ban snapshot and keep it refreshed. Done before listen so the
    // first requests this instance serves already see the current ban list.
    startBanSync();

    // Initialize cron jobs for pricing and visibility score recalculation
    try {
      const { initializeCronJobs } = await import('./services/cron.service.js');
      initializeCronJobs();
    } catch (error) {
      logger.warn('Failed to initialize cron jobs', {
        error: error.message,
        note: 'Cron jobs will not run. Install node-cron package if needed.',
      });
    }

    // Bootstrap FX rates: if no exchange rates in DB, fetch immediately on startup.
    // This ensures prices work on first deploy without waiting for 4AM cron.
    try {
      const ExchangeRate = (await import('./models/exchangeRate.model.js')).default;
      const latest = await ExchangeRate.getLatest();
      if (!latest) {
        logger.info('🌍 No FX rates found in DB — bootstrapping exchange rates now...');
        const { fetchLatestRates } = await import('./services/fx.service.js');
        const result = await fetchLatestRates();
        if (result.success) {
          logger.info('✅ FX bootstrap complete', {
            date: result.date,
            ratesCount: result.ratesCount,
            missingCurrencies: result.missingCurrencies,
          });
        } else {
          logger.warn('⚠️  FX bootstrap failed (prices will fall back to USD)', {
            errors: result.errors,
          });
        }
      } else {
        const ageHours = ((Date.now() - new Date(latest.fetchedAt).getTime()) / 3600000).toFixed(1);
        logger.info(`✅ FX rates in DB (${ageHours}h old, date: ${latest.date}) — skipping bootstrap`);
      }
    } catch (fxError) {
      logger.warn('FX bootstrap check failed', { error: fxError.message });
    }

    // Optionally boot in-process notification workers (single-dyno deploys).
    // No-op when ENABLE_QUEUE !== 'true' or RUN_WORKERS_INPROCESS !== 'true'.
    try {
      const { startInProcessWorkers } = await import('./workers/index.js');
      const inProcWorkers = await startInProcessWorkers();
      if (inProcWorkers.length > 0) {
        logger.info('In-process notification workers running', {
          roles: inProcWorkers.map((w) => w.role),
        });
      }
    } catch (error) {
      logger.warn('Failed to start in-process workers', { error: error.message });
    }

    // Start server only after successful database connection
    const server = app.listen(PORT, '0.0.0.0', () => {
      const address = server.address();
      logger.info(`Server started on port ${PORT}`, {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        database: 'connected',
        address: address ? `${address.address}:${address.port}` : 'unknown',
        listening: true
      });
    });

    // Release the ban-sync interval and its Redis client on shutdown so the
    // process can exit cleanly instead of being killed after the grace period.
    const shutdown = async (signal) => {
      logger.info('Shutting down', { signal });
      stopBanSync();
      server.close();
      await closeRateLimitRedis();
      process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    // Handle server errors (must be set before listen callback)
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`, { port: PORT });
      } else {
        logger.error('Server error', { error: error.message, code: error.code });
      }
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error.message,
      port: PORT,
    });
    process.exit(1);
  }
})();
