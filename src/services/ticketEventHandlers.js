import notificationService from './notificationService.js';
import Ticket from '../models/ticket.model.js';
import logger from '../lib/logger.js';

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

    logger.info('TICKET_CREATED notification sent', { ticketId: populated._id.toString() });
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
