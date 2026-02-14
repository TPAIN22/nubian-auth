import Dispute from "../models/dispute.model.js";

class DisputeRepository {
  async createDispute(disputeData) {
    const dispute = new Dispute(disputeData);
    return await dispute.save();
  }

  async findByTicketId(ticketId) {
    return await Dispute.findOne({ ticketId });
  }

  async findById(disputeId) {
    return await Dispute.findById(disputeId);
  }

  async updateStatus(disputeId, status, resolutionNotes) {
    const update = { status };
    if (resolutionNotes) {
      update.resolutionNotes = resolutionNotes;
    }
    return await Dispute.findByIdAndUpdate(
      disputeId,
      update,
      { new: true }
    );
  }

  async count(filter) {
      return await Dispute.countDocuments(filter);
  }
}

export default new DisputeRepository();
