import { getAuth } from '@clerk/express';

import User from '../models/user.model.js';
import logger from '../lib/logger.js';
import { sendSuccess, sendError, sendUnauthorized } from '../lib/response.js';

/**
 * Merchant dashboard onboarding progress.
 *
 * Deliberately gated on `isAuthenticated` alone rather than on an approved
 * merchant. Two reasons:
 *
 *   1. It stores nothing about a store — only how far one PERSON has read
 *      through a product tour. There is nothing here to leak.
 *   2. The console must keep working when this call fails. Gating it on
 *      `isApprovedMerchant` adds a second way for the request to 403 (a store
 *      suspended mid-session, a stale membership), and a 403 on a UI preference
 *      would be indistinguishable from "you have not started the tour" — which
 *      is how a merchant who finished the tour ends up seeing it again.
 *
 * The shape mirrors what the dashboard stores locally, so the client can treat
 * a cached snapshot and a server response interchangeably.
 */

const TERMINAL = new Set(['COMPLETED', 'SKIPPED']);

const DEFAULT_STATE = {
  status: 'NOT_STARTED',
  currentStep: null,
  completedSteps: [],
  version: 1,
  updatedAt: null,
};

/** Normalizes a stored subdocument (or its absence) into the wire shape. */
function serialize(stored) {
  if (!stored) return { ...DEFAULT_STATE };
  return {
    status: stored.status || DEFAULT_STATE.status,
    currentStep: stored.currentStep ?? null,
    completedSteps: Array.isArray(stored.completedSteps) ? [...stored.completedSteps] : [],
    version: typeof stored.version === 'number' ? stored.version : 1,
    updatedAt: stored.updatedAt ? new Date(stored.updatedAt).toISOString() : null,
  };
}

/**
 * GET /api/merchants/onboarding
 *
 * Answers with the default NOT_STARTED state for a user who has no row yet
 * rather than 404ing. A user can reach the console before the Clerk webhook has
 * created their Mongo document, and "we have never heard of you" and "you have
 * not started" mean exactly the same thing to the tour.
 */
export const getMerchantOnboarding = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return sendUnauthorized(res, 'Authentication required');

    const user = await User.findOne({ clerkId: userId })
      .select('merchantOnboarding')
      .lean();

    return sendSuccess(res, {
      data: serialize(user?.merchantOnboarding),
      message: 'Onboarding state retrieved',
    });
  } catch (error) {
    logger.error('Error reading merchant onboarding state', {
      requestId: req.requestId,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to retrieve onboarding state',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  }
};

/**
 * PUT /api/merchants/onboarding
 *
 * A partial update: any of `status`, `currentStep`, `completedSteps` may be
 * omitted and keeps its stored value.
 *
 * `completedSteps` is UNIONED with what is already stored, never replaced. The
 * tour fires this from whichever tab or device the merchant happens to be on,
 * and last-write-wins on an array means finishing a step in one tab can erase
 * a step finished in another.
 *
 * Upserts, because a merchant can start the tour before the Clerk webhook has
 * created their user row — losing their progress to a race would be worse than
 * writing a near-empty document that `syncUser` later fills in.
 */
export const updateMerchantOnboarding = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return sendUnauthorized(res, 'Authentication required');

    const { status, currentStep, completedSteps, version } = req.body ?? {};

    const set = { 'merchantOnboarding.updatedAt': new Date() };
    if (status !== undefined) {
      set['merchantOnboarding.status'] = status;
      // A finished or abandoned tour has nowhere to resume to. Clearing this
      // here rather than trusting the client keeps the two fields consistent
      // even if a stale tab posts a step id alongside COMPLETED.
      if (TERMINAL.has(status)) set['merchantOnboarding.currentStep'] = null;
    }
    if (currentStep !== undefined && !TERMINAL.has(status)) {
      set['merchantOnboarding.currentStep'] = currentStep || null;
    }
    if (version !== undefined) set['merchantOnboarding.version'] = version;

    const update = { $set: set };
    if (Array.isArray(completedSteps) && completedSteps.length > 0) {
      update.$addToSet = { 'merchantOnboarding.completedSteps': { $each: completedSteps } };
    }

    const user = await User.findOneAndUpdate({ clerkId: userId }, update, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    })
      .select('merchantOnboarding')
      .lean();

    return sendSuccess(res, {
      data: serialize(user?.merchantOnboarding),
      message: 'Onboarding state saved',
    });
  } catch (error) {
    // A concurrent upsert on the unique clerkId index is a race, not a failure:
    // the other writer created the row, so read it back rather than 500ing at a
    // merchant who is only trying to advance a tooltip.
    if (error?.code === 11000) {
      try {
        const { userId } = getAuth(req);
        const existing = await User.findOne({ clerkId: userId })
          .select('merchantOnboarding')
          .lean();
        if (existing) {
          return sendSuccess(res, {
            data: serialize(existing.merchantOnboarding),
            message: 'Onboarding state saved',
          });
        }
      } catch {
        /* fall through to the generic error below */
      }
    }

    logger.error('Error saving merchant onboarding state', {
      requestId: req.requestId,
      error: error.message,
    });
    return sendError(res, {
      message: 'Failed to save onboarding state',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  }
};
