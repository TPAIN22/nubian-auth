import Ticket from "../models/ticket.model.js";
import Product from "../models/product.model.js";
import Merchant from "../models/merchant.model.js";
import logger from "../lib/logger.js";

class RiskEngineService {
  
  // Arabic keywords for risk
  // "تسمم" (poisoning), "ضرر" (harm/damage), "احتيال" (fraud), "مزور" (fake/forged)
  RISK_KEYWORDS = ["تسمم", "ضرر", "احتيال", "مزور"];

  /**
   * Evaluate a ticket for risk BEFORE it is saved.
   * Modifies the ticket object directly.
   */
  evaluateTicketRisk(ticketData) {
    let riskScore = ticketData.riskScore || 0;
    let priority = ticketData.priority || 'medium';
    let status = ticketData.status || 'open';
    const description = ticketData.description || "";
    const subject = ticketData.subject || "";

    // 1. Auto escalation rules
    // If category = fraud OR health_risk
    if (ticketData.category === 'fraud' || ticketData.category === 'health_risk') {
        priority = 'high';
        status = 'escalated'; // Requirement: status = escalated
        riskScore += 50;
    }

    // 2. Keyword detection
    const textToCheck = `${subject} ${description}`;
    const foundKeywords = this.RISK_KEYWORDS.filter(keyword => textToCheck.includes(keyword));
    
    if (foundKeywords.length > 0) {
        riskScore += 30;
        // Optionally escalate if risk keywords found, though req only says increase score.
        // But usually high risk score implies higher priority. 
        // For now, adhering strictly to "increase riskScore by 30".
    }

    return {
        ...ticketData,
        riskScore,
        priority,
        status
    };
  }

  /**
   * Check Product Risk Logic (Post-creation async check)
   * If a product receives 3 high-priority tickets within 30 days -> set product.status = "suspended"
   */
  async checkProductRisk(productId) {
      if (!productId) return;

      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const highPriorityCount = await Ticket.countDocuments({
            relatedProductId: productId,
            priority: 'high',
            createdAt: { $gte: thirtyDaysAgo }
        });

        if (highPriorityCount >= 3) {
            await Product.findByIdAndUpdate(productId, {
                status: 'suspended',
                isActive: false, // syncing legacy field
                suspensionReason: `Automated suspension: Received ${highPriorityCount} high-priority tickets in last 30 days.`
            });
            logger.warn(`Product ${productId} automatically suspended due to risk rules.`);
        }
      } catch (error) {
          logger.error(`Error checking product risk for ${productId}:`, error);
      }
  }

  /**
   * Merchant Flag Logic (Post-creation async check)
   * If merchant receives 5 high-risk tickets -> merchant.flagged = true
   * "High-risk ticket" can be defined as priority=high OR riskScore > 50?
   * Requirement says "5 high-risk tickets". I'll assume tickets with riskScore >= 50 or category=fraud/health_risk are "high risk".
   * Let's use riskScore > 50 as a threshold for "High Risk".
   */
  async checkMerchantRisk(merchantId) {
      if (!merchantId) return;

      try {
        // Count tickets with high risk score or critical categories
        const highRiskCount = await Ticket.countDocuments({
            relatedMerchantId: merchantId,
            $or: [
                { riskScore: { $gte: 50 } },
                { category: { $in: ['fraud', 'health_risk'] } }
            ]
        });

        if (highRiskCount >= 5) {
            await Merchant.findByIdAndUpdate(merchantId, {
                isFlagged: true,
                flaggedAt: new Date(),
                flagReason: `Automated flag: Associated with ${highRiskCount} high-risk tickets.`
            });
            logger.warn(`Merchant ${merchantId} automatically flagged due to risk rules.`);
        }
      } catch (error) {
          logger.error(`Error checking merchant risk for ${merchantId}:`, error);
      }
  }
}

export default new RiskEngineService();
