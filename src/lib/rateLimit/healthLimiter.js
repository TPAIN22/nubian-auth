/**
 * Shared limiter for liveness/readiness probes.
 *
 * Lives in its own module because both health.route.js and the `/ping` handler
 * in index.js need the *same* limiter instance — two instances would mean two
 * independent budgets under one name.
 *
 * Generous enough that a 1/s platform health check never notices, tight enough
 * that the probes can't serve as a free amplification target. Never
 * ban-escalating: blocking the platform's own prober would mark the service down.
 */
import { createLimiter } from './index.js';

export const healthProbeLimiter = createLimiter({
  name: 'health',
  windowMs: 60 * 1000,
  limit: 120,
  message: 'Too many health check requests.',
  countsTowardBan: false,
});
