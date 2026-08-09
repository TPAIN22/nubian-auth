import { clerkClient, getAuth } from '@clerk/express';
import Merchant from '../models/merchant.model.js';
import MerchantMember from '../models/merchantMember.model.js';
import { permissionsForRole } from '../lib/merchantPermissions.js';
import {
  syncMemberClerkMetadata,
  revokeMembership,
} from '../services/merchantMembership.service.js';
import { queueMerchantInviteEmail } from '../services/mailService.js';
import logger from '../lib/logger.js';
import {
  sendSuccess,
  sendError,
  sendCreated,
  sendNotFound,
} from '../lib/response.js';

// Roles an owner may hand out. 'owner' is deliberately absent — a store has
// exactly one owner (enforced by a partial unique index) and it changes only
// through transferOwnership.
const ASSIGNABLE_ROLES = ['manager', 'staff'];

const DASHBOARD_BASE_URL =
  process.env.DASHBOARD_BASE_URL || process.env.AFFILIATE_BASE_URL || 'https://www.nubian-sd.com';

const buildAcceptUrl = (merchantId) =>
  `${DASHBOARD_BASE_URL.replace(/\/$/, '')}/merchant/invite/accept?store=${merchantId}`;

/** Shape a membership for the API. Never leaks anything but the member's own email. */
const presentMember = (m) => ({
  id: m._id.toString(),
  email: m.email,
  role: m.role,
  status: m.status,
  userId: m.userId || null,
  permissions: permissionsForRole(m.role),
  invitedAt: m.invitedAt || null,
  acceptedAt: m.acceptedAt || null,
  revokedAt: m.revokedAt || null,
  createdAt: m.createdAt,
});

/** Every email Clerk knows for this user, lowercased. Invites match on any of them. */
const clerkEmailsFor = async (clerkUserId) => {
  const user = await clerkClient.users.getUser(clerkUserId);
  return (user.emailAddresses || [])
    .map((e) => e.emailAddress?.toLowerCase().trim())
    .filter(Boolean);
};

/* -------------------------------------------------------------------------- */
/* Reading the team                                                           */
/* -------------------------------------------------------------------------- */

/**
 * List the store's team. Available to any member — knowing who your colleagues
 * are is not privileged, and the dashboard needs it to render the console.
 */
export const listMembers = async (req, res) => {
  try {
    const members = await MerchantMember.find({ merchant: req.merchant._id })
      .sort({ role: 1, createdAt: 1 })
      .lean();

    return sendSuccess(res, {
      data: members.map(presentMember),
      message: 'Team retrieved successfully',
      // An admin viewing somebody else's team is not a member of it, so they
      // have no role and no permissions here — `isAdmin` is what the dashboard
      // reads to decide whether to render the controls anyway.
      meta: {
        role: req.merchantRole ?? null,
        permissions: req.merchantPermissions ?? [],
        isAdmin: Boolean(req.merchantIsAdmin),
      },
    });
  } catch (error) {
    logger.error('Error listing store members', {
      requestId: req.requestId,
      merchantId: req.merchant?._id?.toString(),
      error: error.message,
    });
    throw error;
  }
};

/**
 * Every store the caller belongs to, plus any invites waiting for them.
 *
 * Authenticated-only: this is what the dashboard's store switcher reads, and
 * what tells someone with a pending invite that they have one. Requiring an
 * existing membership here would make invites undiscoverable in-app.
 */
export const listMyMemberships = async (req, res) => {
  try {
    const { userId } = getAuth(req);

    let emails = [];
    try {
      emails = await clerkEmailsFor(userId);
    } catch (clerkError) {
      // Degrade to id-only matching rather than failing the whole listing;
      // active memberships are keyed on userId and don't need the email.
      logger.warn('Could not read Clerk emails for membership listing', {
        requestId: req.requestId,
        userId,
        error: clerkError.message,
      });
    }

    const memberships = await MerchantMember.find({
      $or: [
        { userId, status: 'active' },
        ...(emails.length ? [{ email: { $in: emails }, status: 'invited' }] : []),
      ],
    }).lean();

    const stores = await Merchant.find({
      _id: { $in: memberships.map((m) => m.merchant) },
    })
      .select('storeName status logoUrl city')
      .lean();

    const storeById = new Map(stores.map((s) => [s._id.toString(), s]));

    const data = memberships
      .map((m) => {
        const store = storeById.get(m.merchant.toString());
        // A membership whose store has been deleted is not actionable.
        if (!store) return null;
        return {
          membershipId: m._id.toString(),
          merchantId: store._id.toString(),
          storeName: store.storeName,
          storeStatus: store.status,
          logoUrl: store.logoUrl || null,
          city: store.city || null,
          role: m.role,
          status: m.status,
          permissions: permissionsForRole(m.role),
        };
      })
      .filter(Boolean);

    return sendSuccess(res, {
      data,
      message: 'Memberships retrieved successfully',
    });
  } catch (error) {
    logger.error('Error listing memberships', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/* -------------------------------------------------------------------------- */
/* Changing the team                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Invite someone to the store by email.
 *
 * The invite is matched by email at accept time, so the recipient does not need
 * a Nubian account yet. One row per (store, email) for the life of the
 * relationship: re-inviting somebody who was revoked reuses their row rather
 * than racing a second one through the unique index.
 */
export const inviteMember = async (req, res) => {
  try {
    const { userId: inviterId } = getAuth(req);
    const merchant = req.merchant;
    const email = req.body.email.toLowerCase().trim();
    const role = req.body.role;

    if (!ASSIGNABLE_ROLES.includes(role)) {
      return sendError(res, {
        message: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`,
        code: 'INVALID_ROLE',
        statusCode: 400,
        details: {
          messageAr: 'الصلاحية المحددة غير صالحة.',
        },
      });
    }

    const existing = await MerchantMember.findOne({ merchant: merchant._id, email });

    if (existing?.status === 'active') {
      return sendError(res, {
        message: 'That person is already on this store’s team',
        code: 'ALREADY_A_MEMBER',
        statusCode: 409,
        details: {
          memberId: existing._id.toString(),
          role: existing.role,
          messageAr: 'هذا الشخص عضو في فريق المتجر بالفعل.',
        },
      });
    }

    // Same person, different address. The (merchant, email) index only stops
    // the SAME address being added twice — someone already on the team as
    // alice@personal.com can still be invited as alice@work.com. That collides
    // on (merchant, userId) at accept time and fails there, which means the
    // owner thinks they invited somebody and the invitee hits an error days
    // later. Catch it now, while there is somebody to tell.
    let alreadyOnTeam = null;
    try {
      const matches = await clerkClient.users.getUserList({
        emailAddress: [email],
        limit: 10,
      });
      const userIds = (matches?.data || []).map((u) => u.id);

      if (userIds.length > 0) {
        alreadyOnTeam = await MerchantMember.findOne({
          merchant: merchant._id,
          userId: { $in: userIds },
          status: 'active',
        }).lean();
      }
    } catch (clerkError) {
      // Degrade rather than block: this is a courtesy check, and the unique
      // index still refuses the duplicate at accept time.
      logger.warn('Could not check Clerk for an existing member with that email', {
        requestId: req.requestId,
        merchantId: merchant._id.toString(),
        error: clerkError.message,
      });
    }

    if (alreadyOnTeam) {
      return sendError(res, {
        message: `That person is already on this store’s team as ${alreadyOnTeam.email}`,
        code: 'ALREADY_A_MEMBER',
        statusCode: 409,
        details: {
          memberId: alreadyOnTeam._id.toString(),
          existingEmail: alreadyOnTeam.email,
          role: alreadyOnTeam.role,
          messageAr: `هذا الشخص عضو في الفريق بالفعل عبر البريد ${alreadyOnTeam.email}.`,
        },
      });
    }

    const invitedAt = new Date();

    // Reuses the row for a re-invite or a previously revoked member; the unique
    // (merchant, email) index makes this the only safe way to do it.
    let membership;
    try {
      membership = await MerchantMember.findOneAndUpdate(
        { merchant: merchant._id, email },
        {
          $set: {
            role,
            status: 'invited',
            invitedBy: inviterId,
            invitedAt,
            // A re-invite must not carry the previous revocation forward.
            revokedAt: null,
            revokedBy: null,
          },
          $setOnInsert: { merchant: merchant._id, email },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (inviteError) {
      // Two invites for the same address at once: both miss the findOne above,
      // both try to insert, and the unique index rejects the loser. That is the
      // guard working — report it as the conflict it is, not as a 500.
      if (inviteError?.code === 11000) {
        return sendError(res, {
          message: 'That person has just been invited to this store',
          code: 'ALREADY_A_MEMBER',
          statusCode: 409,
          details: {
            messageAr: 'تم إرسال دعوة إلى هذا الشخص للتو.',
          },
        });
      }
      throw inviteError;
    }

    let inviterName = merchant.storeName;
    try {
      const inviter = await clerkClient.users.getUser(inviterId);
      inviterName =
        [inviter.firstName, inviter.lastName].filter(Boolean).join(' ') ||
        inviter.emailAddresses?.[0]?.emailAddress ||
        merchant.storeName;
    } catch (clerkError) {
      logger.warn('Could not resolve inviter name; falling back to store name', {
        requestId: req.requestId,
        inviterId,
        error: clerkError.message,
      });
    }

    try {
      await queueMerchantInviteEmail({
        to: email,
        storeName: merchant.storeName,
        inviterName,
        role,
        acceptUrl: buildAcceptUrl(merchant._id.toString()),
        merchantId: merchant._id.toString(),
        invitedAt,
      });
    } catch (mailError) {
      // The invite exists and is acceptable in-app from /my-memberships, so a
      // mail failure must not roll it back — but it does need to be visible.
      logger.error('Invite created but the email failed to send', {
        requestId: req.requestId,
        merchantId: merchant._id.toString(),
        email,
        error: mailError.message,
      });
    }

    logger.info('Store member invited', {
      requestId: req.requestId,
      merchantId: merchant._id.toString(),
      memberId: membership._id.toString(),
      role,
      invitedBy: inviterId,
    });

    return sendCreated(res, presentMember(membership), 'Invitation sent');
  } catch (error) {
    logger.error('Error inviting store member', {
      requestId: req.requestId,
      merchantId: req.merchant?._id?.toString(),
      error: error.message,
    });
    throw error;
  }
};

/**
 * Accept an invitation.
 *
 * Authenticated-only by design: the accepting user is not a member yet, so no
 * merchant middleware can gate this. The invite is matched against every email
 * Clerk holds for them, which is what lets someone accept on an address that
 * isn't their primary.
 */
export const acceptInvite = async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { merchantId } = req.body || {};

    let emails;
    try {
      emails = await clerkEmailsFor(userId);
    } catch (clerkError) {
      logger.error('Could not read Clerk emails while accepting an invite', {
        requestId: req.requestId,
        userId,
        error: clerkError.message,
      });
      return sendError(res, {
        message: 'Could not verify your email address. Please try again.',
        code: 'CLERK_ERROR',
        statusCode: 503,
      });
    }

    if (emails.length === 0) {
      return sendError(res, {
        message: 'Your account has no email address to match an invitation against',
        code: 'NO_EMAIL_ON_ACCOUNT',
        statusCode: 400,
      });
    }

    const filter = { email: { $in: emails }, status: 'invited' };
    if (merchantId) filter.merchant = merchantId;

    const invites = await MerchantMember.find(filter);

    if (invites.length === 0) {
      return sendNotFound(res, 'Invitation');
    }

    if (invites.length > 1) {
      return sendError(res, {
        message: 'You have several pending invitations. Specify which store to join.',
        code: 'INVITE_SELECTION_REQUIRED',
        statusCode: 409,
        details: {
          invitations: invites.map((i) => ({
            merchantId: i.merchant.toString(),
            role: i.role,
          })),
        },
      });
    }

    const invite = invites[0];

    // The store must still exist and be live before handing out access to it.
    const merchant = await Merchant.findById(invite.merchant).select('storeName status').lean();
    if (!merchant) {
      return sendNotFound(res, 'Store');
    }

    invite.userId = userId;
    invite.status = 'active';
    invite.acceptedAt = new Date();

    try {
      await invite.save();
    } catch (saveError) {
      // (merchant, userId) is unique: this account already holds a different
      // row on this store — typically an older invite sent to another of their
      // addresses, or the owner row itself.
      if (saveError?.code === 11000) {
        return sendError(res, {
          message: 'Your account already has a membership on this store',
          code: 'ALREADY_A_MEMBER',
          statusCode: 409,
          details: {
            messageAr: 'حسابك مرتبط بهذا المتجر بالفعل.',
          },
        });
      }
      throw saveError;
    }

    // Grants the Clerk role the dashboard middleware gates /merchant/* on.
    await syncMemberClerkMetadata(userId, { requestId: req.requestId });

    logger.info('Store invitation accepted', {
      requestId: req.requestId,
      merchantId: invite.merchant.toString(),
      memberId: invite._id.toString(),
      userId,
      role: invite.role,
    });

    return sendSuccess(res, {
      data: {
        ...presentMember(invite),
        merchantId: invite.merchant.toString(),
        storeName: merchant.storeName,
        storeStatus: merchant.status,
      },
      message: `You have joined ${merchant.storeName}`,
    });
  } catch (error) {
    logger.error('Error accepting invitation', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Change a member's role. Owners are not reassignable here — see
 * transferOwnership.
 */
export const updateMemberRole = async (req, res) => {
  try {
    const { userId: actorId } = getAuth(req);
    const { memberId } = req.params;
    const { role } = req.body;

    if (!ASSIGNABLE_ROLES.includes(role)) {
      return sendError(res, {
        message: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`,
        code: 'INVALID_ROLE',
        statusCode: 400,
      });
    }

    // Scoped to the caller's store — a member id from another store must not
    // be reachable just because the caller happens to be an owner somewhere.
    const membership = await MerchantMember.findOne({
      _id: memberId,
      merchant: req.merchant._id,
    });

    if (!membership) return sendNotFound(res, 'Member');

    if (membership.role === 'owner') {
      return sendError(res, {
        message: 'The owner’s role cannot be changed here. Transfer ownership instead.',
        code: 'CANNOT_DEMOTE_OWNER',
        statusCode: 400,
        details: {
          messageAr: 'لا يمكن تغيير صلاحية مالك المتجر من هنا.',
        },
      });
    }

    const previousRole = membership.role;
    membership.role = role;
    await membership.save();

    logger.info('Store member role changed', {
      requestId: req.requestId,
      merchantId: req.merchant._id.toString(),
      memberId,
      previousRole,
      role,
      changedBy: actorId,
    });

    return sendSuccess(res, {
      data: presentMember(membership),
      message: 'Role updated successfully',
    });
  } catch (error) {
    logger.error('Error updating member role', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Revoke a member's access. The row survives as an audit record and is reused
 * if they are ever invited back.
 */
export const removeMember = async (req, res) => {
  try {
    const { userId: actorId } = getAuth(req);
    const { memberId } = req.params;

    const membership = await MerchantMember.findOne({
      _id: memberId,
      merchant: req.merchant._id,
    });

    if (!membership) return sendNotFound(res, 'Member');

    if (membership.role === 'owner') {
      return sendError(res, {
        message: 'The store owner cannot be removed. Transfer ownership first.',
        code: 'CANNOT_REMOVE_OWNER',
        statusCode: 400,
        details: {
          messageAr: 'لا يمكن إزالة مالك المتجر. قم بنقل الملكية أولاً.',
        },
      });
    }

    if (membership.userId && membership.userId === actorId) {
      return sendError(res, {
        message: 'You cannot remove yourself from the store',
        code: 'CANNOT_REMOVE_SELF',
        statusCode: 400,
      });
    }

    await revokeMembership(membership._id, {
      revokedBy: actorId,
      requestId: req.requestId,
    });

    logger.info('Store member revoked', {
      requestId: req.requestId,
      merchantId: req.merchant._id.toString(),
      memberId,
      revokedBy: actorId,
    });

    return sendSuccess(res, {
      data: { id: memberId, status: 'revoked' },
      message: 'Member removed successfully',
    });
  } catch (error) {
    logger.error('Error removing store member', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Hand the store to another active member.
 *
 * Merchant.userId is still the authoritative owner pointer (until it is dropped
 * in a later phase), so it moves too — and because it is unique, a user who
 * already owns a store cannot be handed a second one.
 *
 * NOT atomic: the partial unique index on (merchant, role='owner') forces the
 * outgoing owner to be demoted before the incoming one is promoted, and Mongo
 * transactions need a replica set that this deployment does not assume. A
 * failure between the two steps leaves the store briefly ownerless and is
 * logged at error level; re-running the transfer repairs it.
 */
export const transferOwnership = async (req, res) => {
  try {
    const { userId: actorId } = getAuth(req);
    const { memberId } = req.body;
    const merchant = req.merchant;

    if (req.merchantRole !== 'owner') {
      return sendError(res, {
        message: 'Only the store owner can transfer ownership',
        code: 'OWNER_ONLY',
        statusCode: 403,
      });
    }

    const target = await MerchantMember.findOne({
      _id: memberId,
      merchant: merchant._id,
      status: 'active',
    });

    if (!target) return sendNotFound(res, 'Member');

    if (target.role === 'owner') {
      return sendError(res, {
        message: 'That member already owns this store',
        code: 'ALREADY_OWNER',
        statusCode: 400,
      });
    }

    if (!target.userId) {
      return sendError(res, {
        message: 'That member has not accepted their invitation yet',
        code: 'MEMBER_NOT_ACTIVE',
        statusCode: 400,
      });
    }

    // Merchant.userId is unique — a clear 409 beats an E11000 further down.
    const alreadyOwns = await Merchant.findOne({ userId: target.userId }).select('storeName').lean();
    if (alreadyOwns) {
      return sendError(res, {
        message: 'That member already owns another store',
        code: 'USER_ALREADY_MERCHANT',
        statusCode: 409,
        details: {
          merchantId: alreadyOwns._id.toString(),
          storeName: alreadyOwns.storeName,
        },
      });
    }

    const outgoing = await MerchantMember.findOne({ merchant: merchant._id, role: 'owner' });
    const outgoingUserId = outgoing?.userId || merchant.userId;

    // Demote first: the unique index rejects a second owner row outright.
    if (outgoing) {
      outgoing.role = 'manager';
      await outgoing.save();
    }

    try {
      target.role = 'owner';
      await target.save();

      merchant.userId = target.userId;
      await merchant.save();
    } catch (promoteError) {
      logger.error('Ownership transfer failed after demoting the outgoing owner', {
        requestId: req.requestId,
        merchantId: merchant._id.toString(),
        outgoingUserId,
        targetUserId: target.userId,
        error: promoteError.message,
      });
      // Put the outgoing owner back so the store is not left ownerless.
      if (outgoing) {
        outgoing.role = 'owner';
        await outgoing.save().catch((restoreError) => {
          logger.error('Could not restore the outgoing owner; store has no owner row', {
            requestId: req.requestId,
            merchantId: merchant._id.toString(),
            error: restoreError.message,
          });
        });
      }
      return sendError(res, {
        message: 'Ownership transfer failed and was rolled back. Please try again.',
        code: 'TRANSFER_FAILED',
        statusCode: 500,
      });
    }

    // Both sides' Clerk standing can change: the new owner may have had no
    // merchant role at all, and the outgoing one keeps theirs as a manager.
    await syncMemberClerkMetadata(target.userId, { requestId: req.requestId });
    if (outgoingUserId && outgoingUserId !== target.userId) {
      await syncMemberClerkMetadata(outgoingUserId, { requestId: req.requestId });
    }

    logger.info('Store ownership transferred', {
      requestId: req.requestId,
      merchantId: merchant._id.toString(),
      from: outgoingUserId,
      to: target.userId,
      by: actorId,
    });

    return sendSuccess(res, {
      data: presentMember(target),
      message: 'Ownership transferred successfully',
    });
  } catch (error) {
    logger.error('Error transferring ownership', {
      requestId: req.requestId,
      error: error.message,
    });
    throw error;
  }
};
