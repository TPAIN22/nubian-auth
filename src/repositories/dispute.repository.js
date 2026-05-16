import Dispute from "../models/dispute.model.js";

class DisputeRepository {
  async createDispute(disputeData, session) {
    const dispute = new Dispute(disputeData);
    return await dispute.save({ session });
  }

  async findByTicketId(ticketId) {
    return await Dispute.findOne({ ticketId });
  }

  async findById(disputeId) {
    return await Dispute.findById(disputeId);
  }

  async updateStatus(disputeId, update, session) {
    return await Dispute.findByIdAndUpdate(
      disputeId,
      update,
      { session, new: true }
    );
  }

  async count(filter) {
      return await Dispute.countDocuments(filter);
  }
}

export default new DisputeRepository();
