// services/cron.service.js
import cron from "node-cron";
import logger from "../lib/logger.js";
import { recalculateAllProductPricing } from "./pricing.service.js";
import { calculateProductScores } from "./productScoring.service.js";
import { fetchLatestRates } from "./fx.service.js";
import Coupon from "../models/coupon.model.js";

let initialized = false;

// keep task refs so we can stop them
let hourlyTask = null;
let couponTask = null;
let fxTask = null;

// prevent overlapping
let hourlyLock = false;
let couponLock = false;
let fxLock = false;

const CRON_TZ = process.env.CRON_TIMEZONE || "UTC";
const ENABLE_CRONS = process.env.ENABLE_CRONS !== "false"; // default ON

export function initializeCronJobs() {
  if (initialized) {
    logger.warn("Cron jobs already initialized - skipping");
    return;
  }
  initialized = true;

  if (!ENABLE_CRONS) {
    logger.warn("Cron jobs are disabled via ENABLE_CRONS=false");
    return;
  }

  logger.info("Initializing cron jobs...", { timezone: CRON_TZ });

  // =========================
  // Hourly: pricing + scoring
  // =========================
  hourlyTask = cron.schedule(
    "0 * * * *",
    async () => {
      if (hourlyLock) {
        logger.warn("⏭️ Hourly cron skipped (previous run still in progress)");
        return;
      }
      hourlyLock = true;

      logger.info("🕐 Hourly cron job started: Recalculating pricing and visibility scores");
      const startTime = Date.now();

      try {
        const [pricingResult, scoringResult] = await Promise.allSettled([
          recalculateAllProductPricing(),
          calculateProductScores(),
        ]);

        const durationMs = Date.now() - startTime;

        if (pricingResult.status === "fulfilled") {
          logger.info("✅ Pricing recalculation completed", {
            ...(pricingResult.value || {}),
            durationMs,
          });
        } else {
          logger.error("❌ Pricing recalculation failed", {
            error: pricingResult.reason?.message || String(pricingResult.reason) || "Unknown error",
          });
        }

        if (scoringResult.status === "fulfilled") {
          logger.info("✅ Visibility score calculation completed", {
            ...(scoringResult.value || {}),
            durationMs,
          });
        } else {
          logger.error("❌ Visibility score calculation failed", {
            error: scoringResult.reason?.message || String(scoringResult.reason) || "Unknown error",
          });
        }

        logger.info("🕐 Hourly cron job completed", {
          durationMs,
          pricingStatus: pricingResult.status,
          scoringStatus: scoringResult.status,
        });
      } catch (error) {
        logger.error("❌ Hourly cron job error", {
          error: error?.message,
          stack: error?.stack,
          durationMs: Date.now() - startTime,
        });
      } finally {
        hourlyLock = false;
      }
    },
    {
      scheduled: true,
      timezone: CRON_TZ,
    }
  );

  // =========================
  // Daily: auto-expire coupons
  // =========================
  couponTask = cron.schedule(
    "0 0 * * *",
    async () => {
      if (couponLock) {
        logger.warn("⏭️ Coupon cron skipped (previous run still in progress)");
        return;
      }
      couponLock = true;

      logger.info("🕛 Daily cron job started: Auto-expiring coupons");
      const startTime = Date.now();

      try {
        const now = new Date();

        const result = await Coupon.updateMany(
          { isActive: true, endDate: { $lt: now } },
          { $set: { isActive: false } }
        );

        logger.info("✅ Coupon auto-expiration completed", {
          expiredCount: result.modifiedCount ?? result.nModified ?? 0,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        logger.error("❌ Coupon auto-expiration failed", {
          error: error?.message,
          stack: error?.stack,
          durationMs: Date.now() - startTime,
        });
      } finally {
        couponLock = false;
      }
    },
    {
      scheduled: true,
      timezone: CRON_TZ,
    }
  );

  // =========================
  // Daily: FX rate update (4 AM)
  // =========================
  fxTask = cron.schedule(
    "0 4 * * *",
    async () => {
      if (fxLock) {
        logger.warn("⏭️ FX cron skipped (previous run still in progress)");
        return;
      }
      fxLock = true;

      logger.info("🌍 Daily FX cron job started: Updating exchange rates");
      const startTime = Date.now();

      try {
        const result = await fetchLatestRates();
        const durationMs = Date.now() - startTime;

        if (result.success) {
          logger.info("✅ FX rates update completed", {
            date: result.date,
            ratesCount: result.ratesCount,
            missingCurrencies: result.missingCurrencies,
            durationMs,
          });
        } else {
          logger.error("❌ FX rates update failed", {
            errors: result.errors,
            durationMs,
          });
        }
      } catch (error) {
        logger.error("❌ FX cron job error", {
          error: error?.message,
          stack: error?.stack,
          durationMs: Date.now() - startTime,
        });
      } finally {
        fxLock = false;
      }
    },
    {
      scheduled: true,
      timezone: CRON_TZ,
    }
  );

  logger.info("✅ Cron jobs initialized successfully");
  logger.info("   - Hourly pricing + scoring: 0 * * * *");
  logger.info("   - Daily coupon auto-expiration: 0 0 * * *");
  logger.info("   - Daily FX rate update: 0 4 * * *");
}

export function stopCronJobs() {
  logger.info("Stopping cron jobs...");

  try {
    hourlyTask?.stop();
    couponTask?.stop();
    fxTask?.stop();
    hourlyTask = null;
    couponTask = null;
    fxTask = null;

    initialized = false;

    logger.info("✅ Cron jobs stopped");
  } catch (e) {
    logger.error("Failed to stop cron jobs", { error: e?.message });
  }
}
