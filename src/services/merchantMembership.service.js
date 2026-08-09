import { clerkClient } from '@clerk/express';
import Merchant, { isUnclaimedUserId } from '../models/merchant.model.js';
import MerchantMember from '../models/merchantMember.model.js';
import logger from '../lib/logger.js';

// Membership lifecycle, and the Clerk metadata that has to follow it.
//
// Clerk's publicMetadata.role/merchantStatus is per-USER, but a store's status
// is per-STORE, and a user may now belong to several. Everything here exists to
// keep that one-to-many collapsed into the single flag the dashboard middleware
// reads, without a controller ever having to think about it.

// Which store's status wins when a user belongs to more than one. Ranked by how
// much access it grants, so belonging to one healthy store is never masked by
// also belonging to a suspended one.
const STATUS_RANK = {
  approved: 5,
  pending: 4,
  needs_revision: 3,
  rejected: 2,
  suspended: 1,
};

const rank = (status) => STATUS_RANK[status] ?? 0;

// Roles that outrank 'merchant' and must never be overwritten by one. Clerk
// stores a single role per user, so granting merchant access to one of these
// accounts would cost them the console they actually need.
const PRIVILEGED_ROLES = new Set(['admin', 'support']);

/**
 * The single merchantStatus that represents a set of stores.
 *
 * Exported for tests, and because the rule matters: someone who works at a
 * healthy store and a suspended one must keep working the healthy one.
 *
 * @param {string[]} statuses
 * @returns {string|null} null when there are no stores at all
 */
export const pickBestStatus = (statuses) => {
  const known = (statuses || []).filter((s) => rank(s) > 0);
  if (known.length === 0) return null;
  return known.reduce((a, b) => (rank(b) > rank(a) ? b : a));
};

/* -------------------------------------------------------------------------- */
/* Readiness                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Compare what the stores say about ownership against what the membership rows
 * say, and report every place the two disagree.
 *
 * This exists to answer one question: is it safe to delete the legacy fallback
 * in merchant.middleware.js? While the fallback is there, a store whose owner
 * has no membership row still works — the resolver quietly drops back to
 * Merchant.userId. Once it goes, that same store becomes a 403 for its owner.
 * So the fallback may only be removed when this reports zero.
 *
 * Pure, so the comparison can be tested without a database. Callers hand it
 * plain objects; `checkMembershipReadiness` below does the queries.
 *
 * @param {Array} stores - {_id, storeName, userId, status}
 * @param {Array} memberships - {_id, merchant, userId, email, role, status}
 */
export const diffOwnership = (stores = [], memberships = []) => {
  const storeIds = new Set(stores.map((s) => String(s._id)));

  // Placeholder ids are not people: an unclaimed store has no owner to have a
  // membership, and never resolves through the middleware in the first place.
  const owned = stores.filter((s) => s.userId && !isUnclaimedUserId(s.userId));

  const ownerByStore = new Map(
    memberships
      .filter((m) => m.role === 'owner' && m.status === 'active')
      .map((m) => [String(m.merchant), m]),
  );

  const missing = [];
  const mismatched = [];

  for (const store of owned) {
    const owner = ownerByStore.get(String(store._id));

    if (!owner) {
      // The case that breaks when the fallback goes.
      missing.push({
        merchantId: String(store._id),
        storeName: store.storeName,
        userId: store.userId,
        status: store.status,
      });
      continue;
    }

    if (owner.userId !== store.userId) {
      // Drift between the two sources of truth — the fallback and the resolver
      // would hand this request to different people. A half-finished ownership
      // transfer looks exactly like this.
      mismatched.push({
        merchantId: String(store._id),
        storeName: store.storeName,
        storeOwnerUserId: store.userId,
        membershipOwnerUserId: owner.userId,
      });
    }
  }

  // Memberships pointing at a store that no longer exists resolve to a 403 for
  // whoever holds them.
  const orphaned = memberships
    .filter((m) => !storeIds.has(String(m.merchant)))
    .map((m) => ({
      membershipId: String(m._id),
      merchantId: String(m.merchant),
      email: m.email,
      role: m.role,
      status: m.status,
    }));

  return {
    storeCount: stores.length,
    ownedStoreCount: owned.length,
    membershipCount: memberships.length,
    missing,
    mismatched,
    orphaned,
    ready: missing.length === 0 && mismatched.length === 0 && orphaned.length === 0,
  };
};

/** Run {@link diffOwnership} against the database. */
export const checkMembershipReadiness = async () => {
  const [stores, memberships] = await Promise.all([
    Merchant.find({}).select('storeName userId status claimStatus').lean(),
    MerchantMember.find({}).select('merchant userId email role status').lean(),
  ]);

  return diffOwnership(stores, memberships);
};

/**
 * Create or repoint a store's owner membership. Idempotent.
 *
 * Unclaimed stores are skipped — their `unclaimed:<uuid>` userId is a
 * placeholder, not a person, and the owner row is written when an admin links a
 * real account via linkStoreToUser.
 *
 * @param {object} merchant - a Merchant document
 * @returns {Promise<object|null>} the membership, or null if none was warranted
 */
export const ensureOwnerMembership = async (merchant, { requestId } = {}) => {
  if (!merchant?.userId || isUnclaimedUserId(merchant.userId) || !merchant.email) {
    return null;
  }

  try {
    const membership = await MerchantMember.findOneAndUpdate(
      { merchant: merchant._id, role: 'owner' },
      {
        // $set rather than $setOnInsert: linkStoreToUser repoints an existing
        // owner row at a new account, and that must not silently no-op.
        $set: {
          userId: merchant.userId,
          email: merchant.email.toLowerCase().trim(),
          status: 'active',
        },
        $setOnInsert: {
          merchant: merchant._id,
          role: 'owner',
          acceptedAt: merchant.createdAt || new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    logger.info('Owner membership ensured', {
      requestId,
      merchantId: merchant._id.toString(),
      userId: merchant.userId,
    });

    return membership;
  } catch (error) {
    // Deliberately does not fail the caller's primary action: while the legacy
    // fallback exists, the middleware still resolves this owner from
    // Merchant.userId, so a failed write here costs nothing today.
    //
    // It costs everything the moment the fallback is removed — the owner is
    // then locked out of their own store. Hence the marker: alert on it, and
    // treat any occurrence as a reason not to remove the fallback yet.
    // `npm run check:memberships` reports the resulting state directly.
    logger.error('Failed to ensure owner membership', {
      marker: 'membershipWriteFailed',
      requestId,
      merchantId: merchant._id?.toString(),
      userId: merchant.userId,
      error: error.message,
    });
    return null;
  }
};

/**
 * The role/merchantStatus a given Clerk user should currently carry, derived
 * from every store they belong to.
 *
 * @returns {Promise<{role: string, merchantStatus: string}|null>} null when the
 *   user belongs to no store at all and should no longer read as a merchant.
 */
export const computeUserMerchantStatus = async (clerkUserId) => {
  if (!clerkUserId || isUnclaimedUserId(clerkUserId)) return null;

  const memberships = await MerchantMember.find({
    userId: clerkUserId,
    status: 'active',
  })
    .select('merchant')
    .lean();

  let statuses = [];

  if (memberships.length > 0) {
    const stores = await Merchant.find({ _id: { $in: memberships.map((m) => m.merchant) } })
      .select('status')
      .lean();
    statuses = stores.map((s) => s.status);
  } else {
    // Same legacy fallback the resolver uses: a store that predates
    // MerchantMember still points at its owner through Merchant.userId, and
    // must not have its access revoked just because the backfill hasn't run.
    const owned = await Merchant.findOne({ userId: clerkUserId }).select('status').lean();
    if (owned) statuses = [owned.status];
  }

  const best = pickBestStatus(statuses);
  return best ? { role: 'merchant', merchantStatus: best } : null;
};

/**
 * Push a single user's computed merchant standing into Clerk publicMetadata.
 *
 * Clerk failures are logged and swallowed: the database is the source of truth
 * and the caller's action has already succeeded by this point.
 */
export const syncMemberClerkMetadata = async (clerkUserId, { requestId } = {}) => {
  if (!clerkUserId || isUnclaimedUserId(clerkUserId)) return false;

  try {
    const [computed, clerkUser] = await Promise.all([
      computeUserMerchantStatus(clerkUserId),
      clerkClient.users.getUser(clerkUserId),
    ]);

    const existing = clerkUser.publicMetadata || {};
    const next = { ...existing };

    if (computed) {
      // Clerk carries ONE role per user. Writing 'merchant' over 'admin' or
      // 'support' would silently take away the admin console — a far bigger
      // loss than the merchant console it grants — so a privileged role is
      // kept and the membership simply does not translate into console access.
      // The row still exists in Mongo and the store's team page still lists
      // them; they just cannot operate the shop from this account.
      //
      // The mirror of this guard already existed on the clearing path below.
      // Its absence here is what let an invitation demote an admin.
      if (existing.role && PRIVILEGED_ROLES.has(existing.role)) {
        logger.warn('Kept a privileged Clerk role instead of granting merchant access', {
          marker: 'privilegedRoleKept',
          requestId,
          userId: clerkUserId,
          role: existing.role,
          wouldHaveBeen: computed.merchantStatus,
        });
        return false;
      }

      next.role = computed.role;
      next.merchantStatus = computed.merchantStatus;
    } else {
      // No stores left. Only strip a merchant role — an admin who happened to
      // be a member of a store must not be demoted out of the admin console.
      if (existing.role && existing.role !== 'merchant') return false;
      delete next.role;
      delete next.merchantStatus;
    }

    await clerkClient.users.updateUser(clerkUserId, { publicMetadata: next });

    logger.info('Clerk merchant metadata synced', {
      requestId,
      userId: clerkUserId,
      role: next.role ?? null,
      merchantStatus: next.merchantStatus ?? null,
    });

    return true;
  } catch (error) {
    logger.error('Failed to sync Clerk merchant metadata', {
      requestId,
      userId: clerkUserId,
      error: error.message,
    });
    return false;
  }
};

/**
 * Fan a store's status out to everyone who works there.
 *
 * Call AFTER the store document has been saved — the new standing is computed
 * from the database, so each member ends up with the right flag even when they
 * also belong to other stores.
 */
export const syncStoreMembersClerkMetadata = async (merchant, { requestId } = {}) => {
  if (!merchant?._id) return 0;

  const members = await MerchantMember.find({ merchant: merchant._id, status: 'active' })
    .select('userId')
    .lean();

  const userIds = [...new Set(members.map((m) => m.userId).filter(Boolean))];

  // Legacy store with no membership rows yet: behave exactly as this did before
  // memberships existed and update the owner named on the store itself.
  if (userIds.length === 0) {
    if (!merchant.userId || isUnclaimedUserId(merchant.userId)) return 0;
    await syncMemberClerkMetadata(merchant.userId, { requestId });
    return 1;
  }

  let synced = 0;
  for (const userId of userIds) {
    // Sequential on purpose — Clerk rate-limits, and stores have few members.
    if (await syncMemberClerkMetadata(userId, { requestId })) synced++;
  }

  logger.info('Store status fanned out to members', {
    requestId,
    merchantId: merchant._id.toString(),
    status: merchant.status,
    memberCount: userIds.length,
    synced,
  });

  return synced;
};

/**
 * Revoke one person's access to one store, preserving the row for audit and for
 * reuse if they are ever invited back.
 */
export const revokeMembership = async (membershipId, { revokedBy, requestId } = {}) => {
  const membership = await MerchantMember.findByIdAndUpdate(
    membershipId,
    { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: revokedBy || null } },
    { new: true }
  );

  if (membership?.userId) {
    await syncMemberClerkMetadata(membership.userId, { requestId });
  }

  return membership;
};

/**
 * Drop every membership for a store. Used when the store itself is deleted —
 * leaving the rows behind would point members at a store that no longer exists.
 *
 * Returns the userIds that were affected so the caller can resync them.
 */
export const removeMembershipsForStore = async (merchantId, { requestId } = {}) => {
  const members = await MerchantMember.find({ merchant: merchantId }).select('userId').lean();
  const userIds = [...new Set(members.map((m) => m.userId).filter(Boolean))];

  await MerchantMember.deleteMany({ merchant: merchantId });

  logger.info('Memberships removed with store', {
    requestId,
    merchantId: merchantId?.toString(),
    removed: members.length,
  });

  return userIds;
};
