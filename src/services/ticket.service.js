import ticketRepository from "../repositories/ticket.repository.js";
import disputeRepository from "../repositories/dispute.repository.js";
import riskEngineService from "./riskEngine.service.js";
import disputeService from "./dispute.service.js";
import ticketEventHandlers from "./ticketEventHandlers.js";
import Order from "../models/orders.model.js";
import logger from "../lib/logger.js";

class TicketService {
  async createTicket(userId, ticketData) {
    if (ticketData.relatedOrderId) {
        const existingTickets = await ticketRepository.findAll({
            relatedOrderId: ticketData.relatedOrderId,
            status: { $nin: ['resolved_refund', 'resolved_rejected', 'closed'] }
        });
        if (existingTickets.total >= 3) {
            throw new Error("Limit exceeded: Maximum 3 tickets allowed per order.");
        }
    }

    const riskEvaluatedData = riskEngineService.evaluateTicketRisk(ticketData);

    const data = {
      ...riskEvaluatedData,
      userId,
      status: riskEvaluatedData.status || 'open',
      history: [{
          action: 'created',
          timestamp: new Date(),
          user: userId
      }]
    };

    const newTicket = await ticketRepository.createTicket(data);

    if (newTicket.relatedProductId) {
        riskEngineService.checkProductRisk(newTicket.relatedProductId).catch(err => console.error(err));
    }
    if (newTicket.relatedMerchantId) {
        riskEngineService.checkMerchantRisk(newTicket.relatedMerchantId).catch(err => console.error(err));
    }

    if (newTicket.type === 'complaint' && newTicket.relatedOrderId && newTicket.relatedMerchantId) {
        const order = await Order.findById(newTicket.relatedOrderId).lean();
        const amount = ticketData.disputedAmount || order?.totalAmount || 0;
        if (amount > 0) {
            disputeService.createDispute(newTicket, amount).catch(err =>
                console.error("Failed to auto-create dispute:", err)
            );
        }
    }

    ticketEventHandlers.handleTicketCreated(newTicket).catch(err =>
        logger.error("Failed to dispatch TICKET_CREATED event", { error: err.message, ticketId: newTicket?._id })
    );

    return newTicket;
  }

  async getTicketDetails(ticketId, userId, userRole, merchantId = null) {
    const ticket = await ticketRepository.findById(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }

    const isStaff = userRole === 'admin' || userRole === 'support';
    const isOwner = ticket.userId?._id?.toString() === userId.toString();
    const isMerchantOfTicket = merchantId && ticket.relatedMerchantId?._id?.toString() === merchantId.toString();

    if (!isStaff && !isOwner && !isMerchantOfTicket) {
      throw new Error("Unauthorized access to this ticket");
    }

    const messages = await ticketRepository.getMessages(ticketId);
    const dispute = await disputeRepository.findByTicketId(ticketId);

    return {
      ...ticket,
      messages,
      dispute
    };
  }

  async getAllTickets(filter, pagination) {
    return await ticketRepository.findAll(filter, pagination);
  }

  async updateTicketStatus(ticketId, status, adminNotes, userId) {
      return await ticketRepository.updateStatus(ticketId, status, adminNotes);
  }

  async addMessage(ticketId, userId, userRole, messageData, merchantId = null) {
      const ticket = await ticketRepository.findById(ticketId);
      if (!ticket) {
          throw new Error("Ticket not found");
      }

      const isStaff = userRole === 'admin' || userRole === 'support';
      const isOwner = ticket.userId?._id?.toString() === userId.toString();
      const isMerchant = merchantId && ticket.relatedMerchantId?._id?.toString() === merchantId.toString();

      if (!isStaff && !isOwner && !isMerchant) {
          throw new Error("Unauthorized to comment on this ticket");
      }

      if (!isStaff && !isMerchant && isOwner && ticket.status === 'waiting_customer') {
          await ticketRepository.updateStatus(ticketId, 'under_review');
      }

      if ((isStaff || isMerchant) && (ticket.status === 'open' || ticket.status === 'under_review')) {
          await ticketRepository.updateStatus(ticketId, 'waiting_customer');
      }

      const senderRole = userRole === 'admin' ? 'admin'
                       : userRole === 'support' ? 'support'
                       : isMerchant ? 'merchant'
                       : 'user';

      const savedMessage = await ticketRepository.addMessage({
          ticketId,
          senderId: userId,
          senderRole,
          message: messageData.message,
          attachments: messageData.attachments
      });

      ticketEventHandlers.handleTicketMessageAdded(ticket, savedMessage).catch(err =>
          logger.error("Failed to dispatch ticket message event", { error: err.message, ticketId, messageId: savedMessage?._id })
      );

      return savedMessage;
  }

  async getStats() {
      const openTickets = await ticketRepository.findAll({ status: 'open' });
      const highRisk = await ticketRepository.findAll({
          riskScore: { $gte: 50 },
          status: { $nin: ['resolved_refund', 'resolved_rejected', 'closed'] }
      });
      const activeDisputes = await disputeRepository.count({ status: 'pending' });

      const overdue = await ticketRepository.findAll({
          slaDeadline: { $lt: new Date() },
          status: { $nin: ['resolved_refund', 'resolved_rejected', 'closed'] }
      });

      return {
          openTickets: openTickets.total,
          highRisk: highRisk.total,
          activeDisputes: activeDisputes || 0,
          overdue: overdue.total
      };
  }
}

export default new TicketService();
