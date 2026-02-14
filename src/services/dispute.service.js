import disputeRepository from "../repositories/dispute.repository.js";
import merchantRepository from "../repositories/merchant.repository.js";
import mongoose from "mongoose";
import logger from "../lib/logger.js";

class DisputeService {

  /**
   * Create a dispute and freeze merchant balance.
   * MUST ensure merchant has enough balance? 
   * Requirement says "Freeze merchant balance". If balance < 0, maybe allow negative?
   * For now, strict: assuming balance logic allows temporary negative or we check it.
   */
  async createDispute(ticketData, amount) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const disputeData = {
            ticketId: ticketData._id,
            orderId: ticketData.relatedOrderId,
            merchantId: ticketData.relatedMerchantId,
            amount: amount,
            reason: ticketData.description,
            frozen: true,
            status: 'pending'
        };

        const dispute = await disputeRepository.createDispute(disputeData, session); // Need to pass session to repo

        // Freeze balance
        await merchantRepository.freezeBalance(ticketData.relatedMerchantId, amount, session);

        await session.commitTransaction();
        return dispute;
    } catch (error) {
        await session.abortTransaction();
        logger.error("Dispute Creation Failed", error);
        throw error;
    } finally {
        session.endSession();
    }
  }

  /**
   * Resolve Dispute
   * resolution: 'refund_full' | 'refund_partial' | 'rejected'
   */
  async resolveDispute(disputeId, resolution, approvedAmount, adminNote, adminId) {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
          const dispute = await disputeRepository.findById(disputeId);
          if (!dispute) throw new Error("Dispute not found");
          if (dispute.status !== 'pending') throw new Error("Dispute already resolved");

          let status = 'pending';
          const originalAmount = dispute.amount;

          if (resolution === 'refund_full') {
              status = 'refunded';
              // Money leaves frozen balance permanently (refunded to user)
              await merchantRepository.deductFrozenBalance(dispute.merchantId, originalAmount, session);
              // TODO: Trigger Refund to User via Payment Gateway
          } 
          else if (resolution === 'rejected') {
              status = 'rejected'; // Dispute lost by user, merchant keeps money
              // Return money to main balance
              await merchantRepository.unfreezeBalance(dispute.merchantId, originalAmount, session);
          }
          else if (resolution === 'refund_partial') {
              status = 'resolved_partial';
              // e.g. Dispute 100. Refund 50.
              // Deduct 50 from frozen. Return 50 to balance.
              if (!approvedAmount) throw new Error("Partial refund requires amount");
              
              await merchantRepository.deductFrozenBalance(dispute.merchantId, approvedAmount, session); // Refunded part
              await merchantRepository.unfreezeBalance(dispute.merchantId, originalAmount - approvedAmount, session); // Returned part
          }

          // Update dispute
          const updatedDispute = await disputeRepository.updateStatus(
              disputeId, 
              status, 
              adminNote,
              session
          );
          
          updatedDispute.resolution = resolution;
          updatedDispute.adminDecisionNote = adminNote;
          updatedDispute.resolvedBy = adminId;
          updatedDispute.resolvedAt = new Date();
          updatedDispute.frozen = false; // logic resolved
          
          await updatedDispute.save({ session });

          await session.commitTransaction();
          return updatedDispute;

      } catch (error) {
          await session.abortTransaction();
          logger.error("Dispute Resolution Failed", error);
          throw error;
      } finally {
          session.endSession();
      }
  }
}

export default new DisputeService();
