import Ticket from "../models/ticket.model.js";
import TicketMessage from "../models/ticketMessage.model.js";
import Counter from "../models/counter.model.js";

class TicketRepository {
  /**
   * Generate next ticket number
   * Format: NB-YYYY-XXXXX
   */
  async generateTicketNumber() {
    const year = new Date().getFullYear();
    const counterId = `ticket_${year}`;
    
    const counter = await Counter.findByIdAndUpdate(
      counterId,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const sequence = counter.seq.toString().padStart(5, '0');
    return `NB-${year}-${sequence}`;
  }

  async createTicket(ticketData) {
    const ticketNumber = await this.generateTicketNumber();
    const ticket = new Ticket({
      ...ticketData,
      ticketNumber,
    });
    return await ticket.save();
  }

  async findById(ticketId) {
    return await Ticket.findById(ticketId)
      .populate('userId', 'fullName emailAddress phone')
      .populate('relatedOrderId', 'orderNumber totalAmount')
      .populate('relatedProductId', 'name')
      .lean(); // Use lean for performance unless we need save()
  }

  async findByTicketNumber(ticketNumber) {
    return await Ticket.findOne({ ticketNumber })
      .populate('userId', 'fullName emailAddress phone');
  }

  async findAll(filter = {}, pagination = { skip: 0, limit: 20 }, sort = { createdAt: -1 }) {
    const [tickets, total] = await Promise.all([
      Ticket.find(filter)
        .populate('userId', 'fullName emailAddress')
        .sort(sort)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      Ticket.countDocuments(filter)
    ]);
    
    return { tickets, total };
  }

  async updateStatus(ticketId, status, adminNotes) {
    const update = { status };
    if (adminNotes) {
      update.adminNotes = adminNotes;
    }
    return await Ticket.findByIdAndUpdate(
      ticketId, 
      update, 
      { new: true }
    );
  }

  async addMessage(messageData) {
    const message = new TicketMessage(messageData);
    return await message.save();
  }

  async getMessages(ticketId) {
    return await TicketMessage.find({ ticketId })
      .populate('senderId', 'fullName emailAddress') // CAUTION: senderId can refer to User
      .sort({ createdAt: 1 })
      .lean();
  }

  async countUserOpenTickets(userId) {
     return await Ticket.countDocuments({ 
         userId, 
         status: { $nin: ['resolved_refund', 'resolved_rejected', 'closed'] } 
     });
  }
}

export default new TicketRepository();
