import express from "express";
import {
  getCart,
  updateCart,
  addToCart,
  removeFromCart,
} from "../controllers/cart.controller.js";

import { isAuthenticated } from "../middleware/auth.middleware.js";
import logger from "../lib/logger.js";

const router = express.Router();

// Test route to verify routing is working (remove in production)
if (process.env.NODE_ENV !== 'production') {
  router.get("/test", (req, res) => {
    res.json({ 
      message: "Cart routes are working", 
      timestamp: new Date().toISOString(),
      path: req.path,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
    });
  });
}

// Debug route to check if routes are being registered (no auth required)
// Available in production for troubleshooting
router.get("/debug", (req, res) => {
  res.json({
    message: "Cart routes debug",
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
    url: req.url,
    hasAuth: !!req.auth,
    authUserId: req.auth?.userId,
    timestamp: new Date().toISOString(),
  });
});

// Test POST route without auth to verify routing works
router.post("/test-post", (req, res) => {
  logger.info('Test POST route called', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
  });
  res.json({
    message: "POST route test - routing works!",
    method: req.method,
    path: req.path,
    body: req.body,
  });
});

// All cart routes require authentication for security
// Note: Routes are relative to /api/carts
// GET /api/carts -> router.get("/", ...) matches this

// Add logging middleware to debug route matching
const logRoute = (req, res, next) => {
  logger.info('Cart route matched - handler reached', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
    url: req.url,
    route: '/api/carts' + req.path,
  });
  next();
};

// IMPORTANT: Register routes in order - specific routes BEFORE root route
// Express matches routes in order, so "/add" must come before "/"

// Health check route (no auth) - helps verify deployment
router.get("/health", (req, res) => {
  logger.info('Health check route called', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
  });
  res.json({
    status: "ok",
    service: "cart-api",
    timestamp: new Date().toISOString(),
    routes: {
      "GET /api/carts": "Get user cart",
      "POST /api/carts/add": "Add to cart",
      "PUT /api/carts/update": "Update cart",
      "DELETE /api/carts/remove": "Remove from cart",
    }
  });
});

// Specific routes first (before root route)
router.post("/add", logRoute, isAuthenticated, addToCart);
router.put("/update", logRoute, isAuthenticated, updateCart);
router.delete("/remove", logRoute, isAuthenticated, removeFromCart);

// Root route last (catches GET /api/carts)
router.get("/", logRoute, isAuthenticated, getCart);

export default router;
