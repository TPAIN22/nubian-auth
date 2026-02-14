import Merchant from "../models/merchant.model.js";

class MerchantRepository {
  
  async findById(id) {
    return await Merchant.findById(id);
  }

  async freezeBalance(merchantId, amount, session) {
    // Atomically decrement balance and increment frozenBalance
    return await Merchant.findByIdAndUpdate(
        merchantId,
        { 
            $inc: { balance: -amount, frozenBalance: amount } 
        },
        { new: true, session }
    );
  }

  async unfreezeBalance(merchantId, amount, session) {
    // Reverse of freeze
    return await Merchant.findByIdAndUpdate(
        merchantId,
        { 
            $inc: { balance: amount, frozenBalance: -amount } 
        },
        { new: true, session }
    );
  }

  async deductFrozenBalance(merchantId, amount, session) {
      // Used when a refund is confirmed (money taken from frozen balance)
      return await Merchant.findByIdAndUpdate(
          merchantId,
          {
              $inc: { frozenBalance: -amount }
          },
          { new: true, session }
      );
  }
}

export default new MerchantRepository();
