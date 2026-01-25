import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { connect } from './lib/db.js';
import productRoutes from './routes/products.route.js';
import orderRoutes from './routes/orders.route.js';
import cartRoutes from './routes/carts.route.js';
import reviewRoutes from './routes/reviews.route.js';
import categoryRoutes from './routes/categories.route.js';
import userRoutes from './routes/users.route.js';
import webhookRoutes from './routes/webhook.routes.js';
import { clerkMiddleware } from '@clerk/express';
import NotificationsRoutes from './routes/notifications.route.js';
import bannerRoutes from './routes/banners.route.js';
import wishlistRoutes from './routes/wishlist.route.js';
import addressRoutes from './routes/address.route.js';
import couponRoutes from './routes/coupons.route.js';
import locationRoutes from './routes/location.route.js';
import merchantRoutes from './routes/merchant.route.js';
import homeRoutes from './routes/home.route.js';
import healthRoutes from './routes/health.route.js';
import recommendationsRoutes from './routes/recommendations.route.js';
import trackingRoutes from './routes/tracking.route.js';
import analyticsRoutes from './routes/analytics.route.js';
import uploadRoutes from './routes/upload.route.js';
import { requestLogger } from './middleware/logger.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.middleware.js';
import logger from './lib/logger.js';
import { validateEnv } from './lib/envValidator.js';
dotenv.config();

// Validate environment variables on startup
try {
  validateEnv();
} catch (error) {
  logger.error('Environment validation failed', { error: error.message });
  process.exit(1);
}

const app = express();

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
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5000, // Increased to 5000 to handle multiple reloads and dashboard requests
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  validate: { trustProxy: false }, // Disable trust proxy validation in development
});

// Stricter rate limit for authentication-related endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5000, // Limit each IP to 5000 requests per windowMs
  message: 'Too many authentication attempts, please try again later.',
  validate: { trustProxy: false }, // Disable trust proxy validation in development
});

// 🧩 CORS Configuration
logger.info('CORS: Enabled for all origins with credentials');

app.use(cors({
  origin: true, // Allow all origins
  credentials: true, // Allow cookies and authorization headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
}));

// Request logging middleware (must be befoe routes)
app.use(requestLogger);

// Health check endpoints (before authentication and body parsing)
app.use('/', healthRoutes);
app.get("/ping", (_, res) => res.send("pong"));

// ⚠️ IMPORTANT: Webhook routes must be registered BEFORE express.json()
// Webhooks need raw body for signature verification - express.json() consumes the body stream
// Apply stricter rate limiting to authentication-related endpoints
// Webhooks handle authentication events (user.created, user.updated, user.deleted)
app.use('/api/webhooks', authLimiter, express.raw({ type: 'application/json' }), webhookRoutes);

// 🛡️ Security: Request size limits (prevent large payload attacks)
// Register body parsers AFTER webhook routes so webhooks can access raw body
// These parsers will apply to all subsequent routes
app.use(express.json({ limit: '10mb' })); // Limit JSON payload to 10MB
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Limit URL-encoded payload to 10MB

// Apply general rate limiting to all other API routes
// This applies to routes that don't match the more specific routes above
app.use('/api', limiter);


// Configure Clerk middleware to handle Bearer tokens from Authorization header
// This is essential for mobile app authentication
// Trust proxy for proper IP detection behind reverse proxy (Render)
// This fixes the rate limiting warning about X-Forwarded-For header
app.set('trust proxy', true);

// Note: clerkMiddleware should NOT block routes - it just adds auth context
app.use(clerkMiddleware({
  // Clerk will automatically check Authorization header for Bearer tokens
  // This allows both session-based and token-based authentication
  // Mobile apps send tokens in the Authorization: Bearer <token> header
  // The middleware will automatically extract and validate these tokens
}));

// Debug middleware to log all incoming API requests
app.use('/api', (req, res, next) => {
  logger.info('Incoming API request', {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    path: req.path,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
    route: req.route?.path,
  });
  next();
});

// API routes - order matters, more specific routes first
// Log route registration for debugging
logger.info('Registering API routes', {
  routes: [
    '/api/reviews',
    '/api/notifications',
    '/api/carts',
    '/api/orders',
    '/api/products',
  ]
});

app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', NotificationsRoutes);
app.use('/api/carts', cartRoutes);  // POST /api/carts/add -> router.post("/add", ...)
app.use('/api/orders', orderRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/recommendations', recommendationsRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/upload', uploadRoutes);

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

// 🟢 بدء السيرفر
const PORT = process.env.PORT || 5000;

// Start server only after database connection is established
(async () => {
  try {
    // Connect to database first
    await connect();
    
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
