// services/cron.service.js
import cron from 'node-cron';
import logger from '../lib/logger.js';
import { recalculateAllProductPricing } from './pricing.service.js';
import { calculateProductScores } from './productScoring.service.js';
import Coupon from '../models/coupon.model.js';

/**
 * Initialize all cron jobs
 * - Hourly: Recalculate dynamic markup and finalPrice for all products
 * - Hourly: Recalculate visibility scores for all products
 */
export function initializeCronJobs() {
  logger.info('Initializing cron jobs...');
  
  // Run every hour at minute 0 (e.g., 1:00, 2:00, 3:00)
  // Cron expression: '0 * * * *' = minute 0 of every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('🕐 Hourly cron job started: Recalculating pricing and visibility scores');
    const startTime = Date.now();
    
    try {
      // Run pricing and scoring in parallel for better performance
      const [pricingResult, scoringResult] = await Promise.allSettled([
        recalculateAllProductPricing(),
        calculateProductScores(),
      ]);
      
      const duration = Date.now() - startTime;
      
      if (pricingResult.status === 'fulfilled') {
        logger.info('✅ Pricing recalculation completed', {
          ...pricingResult.value,
          durationMs: Date.now() - startTime,
        });
      } else {
        logger.error('❌ Pricing recalculation failed', {
          error: pricingResult.reason?.message || 'Unknown error',
        });
      }
      
      if (scoringResult.status === 'fulfilled') {
        logger.info('✅ Visibility score calculation completed', {
          ...scoringResult.value,
        });
      } else {
        logger.error('❌ Visibility score calculation failed', {
          error: scoringResult.reason?.message || 'Unknown error',
        });
      }
      
      logger.info('🕐 Hourly cron job completed', {
        durationMs: duration,
        pricingStatus: pricingResult.status,
        scoringStatus: scoringResult.status,
      });
    } catch (error) {
      logger.error('❌ Hourly cron job error', {
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime,
      });
    }
  }, {
    scheduled: true,
    timezone: 'UTC',
  });
  
  // Daily cron job: Auto-expire coupons at midnight UTC
  // Runs at 00:00 UTC every day
  cron.schedule('0 0 * * *', async () => {
    logger.info('🕐 Daily cron job started: Auto-expiring coupons');
    const startTime = Date.now();
    
    try {
      const now = new Date();
      const result = await Coupon.updateMany(
        {
          isActive: true,
          endDate: { $lt: now },
        },
        {
          $set: { isActive: false },
        }
      );

      logger.info('✅ Coupon auto-expiration completed', {
        expiredCount: result.modifiedCount,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      logger.error('❌ Coupon auto-expiration failed', {
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime,
      });
    }
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  logger.info('✅ Cron jobs initialized successfully');
  logger.info('   - Hourly pricing recalculation: 0 * * * * (every hour at minute 0)');
  logger.info('   - Hourly visibility score calculation: 0 * * * * (every hour at minute 0)');
  logger.info('   - Daily coupon auto-expiration: 0 0 * * * (daily at midnight UTC)');
}

/**
 * Stop all cron jobs (useful for graceful shutdown)
 */
export function stopCronJobs() {
  logger.info('Stopping cron jobs...');
  // Cron jobs are automatically stopped when the process exits
  // This function is here for future use if needed
  logger.info('✅ Cron jobs stopped');
}
