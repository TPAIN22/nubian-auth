import ticketRepository from "../repositories/ticket.repository.js";
import disputeRepository from "../repositories/dispute.repository.js";
import riskEngineService from "./riskEngine.service.js";
import disputeService from "./dispute.service.js";

class TicketService {
  async createTicket(userId, ticketData) {
    // 1. Check open ticket limit
    if (ticketData.relatedOrderId) {
        const existingTickets = await ticketRepository.findAll({
            relatedOrderId: ticketData.relatedOrderId
        });
        if (existingTickets.total >= 3) {
            throw new Error("Limit exceeded: Maximum 3 tickets allowed per order.");
        }
    }

    // 2. Risk Engine Evaluation
    const riskEvaluatedData = riskEngineService.evaluateTicketRisk(ticketData);

    // 3. Prepare data
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

    // 4. Async Risk Checks
    if (newTicket.relatedProductId) {
        riskEngineService.checkProductRisk(newTicket.relatedProductId).catch(err => console.error(err));
    }
    if (newTicket.relatedMerchantId) {
        riskEngineService.checkMerchantRisk(newTicket.relatedMerchantId).catch(err => console.error(err));
    }

    // 5. Auto-create Dispute for Complaints
    if (newTicket.type === 'complaint' && newTicket.relatedOrderId && newTicket.relatedMerchantId) {
        const amount = ticketData.disputedAmount || 0; 
        if (amount > 0) {
            disputeService.createDispute(newTicket, amount).catch(err => 
                console.error("Failed to auto-create dispute:", err)
            );
        }
    }

    return newTicket;
  }

  async getTicketDetails(ticketId, userId, userRole) {
    const ticket = await ticketRepository.findById(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }

    if (userRole !== 'admin' && userRole !== 'support' && ticket.userId._id.toString() !== userId.toString()) {
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

  async addMessage(ticketId, userId, userRole, messageData) {
      const ticket = await ticketRepository.findById(ticketId);
      if (!ticket) {
          throw new Error("Ticket not found");
      }

      if (userRole !== 'admin' && userRole !== 'support' && ticket.userId._id.toString() !== userId.toString()) {
          throw new Error("Unauthorized to comment on this ticket");
      }

      if (userRole === 'user' && ticket.status === 'waiting_customer') {
          await ticketRepository.updateStatus(ticketId, 'under_review');
      }
      
      if ((userRole === 'admin' || userRole === 'support') && ticket.status === 'open') {
          // Optional logic
      }

      return await ticketRepository.addMessage({
          ticketId,
          senderId: userId,
          senderRole: userRole === 'admin' ? 'admin' : (userRole === 'support' ? 'support' : 'user'),
          message: messageData.message,
          attachments: messageData.attachments
      });
  }

  async getStats() {
      const openTickets = await ticketRepository.findAll({ status: 'open' });
      const highRisk = await ticketRepository.findAll({ riskScore: { $gte: 50 } });
      const activeDisputes = await disputeRepository.count({ status: 'pending' });
      
      const overdue = await ticketRepository.findAll({ 
          slaDeadline: { $lt: new Date() },
          status: { $nin: ['resolved', 'closed', 'resolved_refund', 'rejected'] }
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
