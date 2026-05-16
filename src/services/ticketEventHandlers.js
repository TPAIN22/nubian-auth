import notificationService from './notificationService.js';
import Ticket from '../models/ticket.model.js';
import User from '../models/user.model.js';
import logger from '../lib/logger.js';

async function findStaffRecipients() {
  return User.find({ role: { $in: ['admin', 'support'] } })
    .select('_id clerkId role')
    .lean();
}

async function notifyStaff({ type, title, body, deepLink, metadata, dedupSuffix, priority }) {
  const staff = await findStaffRecipients();
  if (!staff.length) {
    logger.info('No admin/support users found for ticket notification fanout', { type });
    return;
  }

  await Promise.all(
    staff.map((s) =>
      notificationService
        .createNotification({
          type,
          recipientType: 'user',
          recipientId: s.clerkId || s._id,
          title,
          body,
          deepLink,
          metadata,
          channel: 'push',
          deduplicationKey: `${type}_${dedupSuffix}_${s._id}`,
          priority,
        })
        .catch((err) =>
          logger.error('Failed to deliver staff ticket notification', {
            type,
            staffId: s._id?.toString(),
            error: err.message,
          })
        )
    )
  );
}

export async function handleTicketCreated(ticket) {
  try {
    if (!ticket || !ticket._id) {
      logger.error('handleTicketCreated called without ticket');
      return;
    }

    const populated = await Ticket.findById(ticket._id).populate('userId').lean();
    if (!populated || !populated.userId) {
      logger.error('Ticket or ticket.userId not found for TICKET_CREATED', { ticketId: ticket._id });
      return;
    }

    const recipient = populated.userId;
    await notificationService.createNotification({
      type: 'TICKET_CREATED',
      recipientType: 'user',
      recipientId: recipient.clerkId || recipient._id,
      title: 'Ticket received',
      body: `Your support ticket ${populated.ticketNumber} has been received. We'll get back to you shortly.`,
      deepLink: `/support/${populated._id}`,
      metadata: {
        ticketId: populated._id.toString(),
        ticketNumber: populated.ticketNumber,
        priority: populated.priority,
        category: populated.category,
        status: populated.status,
      },
      channel: 'push',
      deduplicationKey: `TICKET_CREATED_${populated._id}`,
      priority: 70,
    });

    const isUrgent = populated.priority === 'high' || populated.status === 'escalated';
    await notifyStaff({
      type: 'NEW_TICKET_ADMIN',
      title: isUrgent ? `New ${populated.priority} ticket: ${populated.ticketNumber}` : `New ticket: ${populated.ticketNumber}`,
      body: `${populated.subject || populated.category} — from ${recipient.fullName || recipient.emailAddress || 'a user'}`,
      deepLink: `/admin/support/${populated._id}`,
      metadata: {
        ticketId: populated._id.toString(),
        ticketNumber: populated.ticketNumber,
        priority: populated.priority,
        category: populated.category,
        type: populated.type,
        status: populated.status,
      },
      dedupSuffix: populated._id.toString(),
      priority: isUrgent ? 95 : 65,
    });

    logger.info('TICKET_CREATED notifications sent', { ticketId: populated._id.toString(), urgent: isUrgent });
  } catch (error) {
    logger.error('Failed to handle TICKET_CREATED event', {
      error: error.message,
      stack: error.stack,
      ticketId: ticket?._id,
    });
  }
}

export async function handleTicketMessageAdded(ticket, message) {
  try {
    if (!ticket || !ticket._id || !message) {
      logger.error('handleTicketMessageAdded called with missing args');
      return;
    }

    const populated = await Ticket.findById(ticket._id).populate('userId').lean();
    if (!populated || !populated.userId) {
      logger.error('Ticket or ticket.userId not found for ticket message notification', { ticketId: ticket._id });
      return;
    }

    const senderRole = message.senderRole;

    if (senderRole === 'admin' || senderRole === 'support') {
      const recipient = populated.userId;
      await notificationService.createNotification({
        type: 'TICKET_REPLY',
        recipientType: 'user',
        recipientId: recipient.clerkId || recipient._id,
        title: 'Support replied to your ticket',
        body: `A new reply has been posted on ticket ${populated.ticketNumber}.`,
        deepLink: `/support/${populated._id}`,
        metadata: {
          ticketId: populated._id.toString(),
          ticketNumber: populated.ticketNumber,
          messageId: message._id?.toString(),
          senderRole,
        },
        channel: 'push',
        deduplicationKey: `TICKET_REPLY_${message._id}`,
        priority: 80,
      });

      logger.info('TICKET_REPLY notification sent', {
        ticketId: populated._id.toString(),
        messageId: message._id?.toString(),
      });
    } else if (senderRole === 'user' || senderRole === 'merchant') {
      const sender = populated.userId;
      await notifyStaff({
        type: 'TICKET_REPLY_ADMIN',
        title: `New ${senderRole} reply on ${populated.ticketNumber}`,
        body: `${sender.fullName || sender.emailAddress || 'A user'} replied on "${populated.subject || populated.category}".`,
        deepLink: `/admin/support/${populated._id}`,
        metadata: {
          ticketId: populated._id.toString(),
          ticketNumber: populated.ticketNumber,
          messageId: message._id?.toString(),
          senderRole,
        },
        dedupSuffix: message._id?.toString() || `${populated._id}_${Date.now()}`,
        priority: 75,
      });

      logger.info('TICKET_REPLY_ADMIN fanout sent', {
        ticketId: populated._id.toString(),
        messageId: message._id?.toString(),
        senderRole,
      });
    }
  } catch (error) {
    logger.error('Failed to handle ticket message added event', {
      error: error.message,
      stack: error.stack,
      ticketId: ticket?._id,
      messageId: message?._id,
    });
  }
}

export default {
  handleTicketCreated,
  handleTicketMessageAdded,
};
