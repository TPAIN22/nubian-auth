import Order from '../models/orders.model.js';
import Cart from '../models/carts.model.js';
import Address from '../models/address.model.js';
import Counter from '../models/counter.model.js';
import Currency from '../models/currency.model.js';
import Marketer from '../models/marketer.model.js';
import ReferralTrackingLog from '../models/referralTrackingLog.model.js';
import CouponUsage from '../models/couponUsage.model.js';
import User from '../models/user.model.js';
import couponService from './coupon.service.js';
import { getFxSnapshotForOrder, applyPsychologicalPricing } from './currency.service.js';
import { getProductPrice, mapToObject } from '../utils/cartUtils.js';
import { calculateFinalPrice } from '../lib/pricing.engine.js';
import { ServiceError } from '../lib/errors.js';
import logger from '../lib/logger.js';

// ─── Private helpers (no HTTP knowledge) ─────────────────────────────────────

function buildShippingAddressText(addr) {
  return [
    addr.name,
    addr.city,
    addr.area,
    addr.street,
    addr.building,
    addr.notes ? `ملاحظات: ${addr.notes}` : null,
  ].filter(Boolean).join(' - ').trim();
}

function normalizePaymentMethod(value) {
  const v = String(value || '').trim().toUpperCase();
  if (v === 'BANKAK')           return 'BANKAK';
  if (v === 'CASH' || v === 'CASH_ON_DELIVERY') return 'CASH';
  if (v === 'CARD' || v === 'CREDIT_CARD')      return 'CARD';
  return null;
}

// ─── OrderService ─────────────────────────────────────────────────────────────

class OrderService {
  // ── Address ─────────────────────────────────────────────────────────────────

  /**
   * Resolve and validate a shipping address from an addressId.
   * Enforces ownership: the address must belong to userId.
   *
   * @returns {{ addressText, phoneNumber, city }}
   * @throws  ServiceError if address not found or not owned by user
   */
  async resolveAddress(addressId, userId) {
    if (!addressId) return { addressText: '', phoneNumber: '', city: '' };

    const addr = await Address.findOne({ _id: addressId, user: userId });
    if (!addr) {
      throw new ServiceError('Address not found', 'ADDRESS_NOT_FOUND', 400, [
        { field: 'addressId', message: 'Invalid or inaccessible addressId', value: String(addressId) },
      ]);
    }
    return {
      addressText: buildShippingAddressText(addr),
      phoneNumber: String(addr.phone || addr.whatsapp || '').trim(),
      city:        String(addr.city  || '').trim(),
    };
  }

  // ── Cart → Line Items ────────────────────────────────────────────────────────

  /**
   * Convert a populated cart's products into order line items.
   * Validates stock for every item.  Builds merchant revenue buckets.
   *
   * @param {Array} cartProducts - Populated cart.products
   * @returns {{
   *   orderProducts, totalAmount,
   *   merchantMap, merchantIds,
   *   merchantTotalAmount, platformTotalAmount,
   *   unmerchantedProducts
   * }}
   * @throws ServiceError on missing product or insufficient stock
   */
  buildOrderItems(cartProducts) {
    const orderProducts       = [];
    let totalAmount           = 0;
    const merchantMap         = new Map(); // merchantId → { amount, products[] }
    const merchantIds         = new Set();
    let merchantTotalAmount   = 0;
    let platformTotalAmount   = 0;
    const unmerchantedProducts = [];

    for (const item of cartProducts) {
      if (!item.product) {
        throw new ServiceError(
          'A product in your cart is no longer available',
          'PRODUCT_UNAVAILABLE'
        );
      }
      if (item.product.stock < item.quantity) {
        throw new ServiceError(
          `"${item.product.name}" only has ${item.product.stock} unit(s) in stock`,
          'INSUFFICIENT_STOCK'
        );
      }

      let itemAttributes = {};
      if (item.attributes instanceof Map) {
        itemAttributes = mapToObject(item.attributes);
      } else if (item.attributes && typeof item.attributes === 'object') {
        itemAttributes = item.attributes;
      } else if (item.size) {
        itemAttributes = { size: item.size };
      }

      const itemVariant = item.variantId ? item.product.variants?.id(item.variantId) : null;

      // Authoritative price snapshot — every order line records what the engine
      // returned at checkout time, so completed orders never re-price.
      const pricing = calculateFinalPrice({ product: item.product, variant: itemVariant });
      const itemPrice = pricing.finalPrice || getProductPrice(item.product, itemAttributes);
      const itemTotal = itemPrice * item.quantity;

      totalAmount += itemTotal;

      orderProducts.push({
        product:      item.product._id,
        variantId:    itemVariant?._id || item.variantId || null,
        quantity:     item.quantity,
        attributes:   itemAttributes,
        size:         item.size || null,
        price:        itemPrice,
        merchantPrice: pricing.basePrice,
        nubianMarkup:  pricing.breakdown.nubianMarkup,
        dynamicMarkup: pricing.breakdown.dynamicMarkup,
        originalPrice: pricing.originalPrice,
        discountAmount:     pricing.discountAmount,
        discountPercentage: pricing.discountPercentage,
      });

      const productMerchant = item.product.merchant;
      if (productMerchant) {
        const merchantId = productMerchant._id
          ? productMerchant._id.toString()
          : productMerchant.toString();
        merchantIds.add(merchantId);
        merchantTotalAmount += itemTotal;
        if (!merchantMap.has(merchantId)) merchantMap.set(merchantId, { amount: 0, products: [] });
        const md = merchantMap.get(merchantId);
        md.amount += itemTotal;
        md.products.push({
          product:       item.product._id,
          quantity:      item.quantity,
          price:         itemPrice,
          merchantPrice: itemMerchantPrice,
          nubianMarkup:  itemNubianMarkup,
          dynamicMarkup: itemDynamicMarkup,
        });
      } else {
        platformTotalAmount += itemTotal;
        unmerchantedProducts.push({
          product:       item.product._id,
          name:          item.product.name,
          quantity:      item.quantity,
          price:         itemPrice,
          merchantPrice: itemMerchantPrice,
          total:         itemTotal,
        });
      }
    }

    return {
      orderProducts,
      totalAmount,
      merchantMap,
      merchantIds,
      merchantTotalAmount,
      platformTotalAmount,
      unmerchantedProducts,
    };
  }

  // ── Merchant Revenue ─────────────────────────────────────────────────────────

  /**
   * Proportionally distribute the discount across merchants and compute
   * the net revenue each merchant receives.
   */
  buildMerchantRevenue(merchantMap, merchantTotalAmount, discountAmount) {
    return Array.from(merchantMap.entries()).map(([merchantId, data]) => {
      const share = merchantTotalAmount > 0 ? data.amount / merchantTotalAmount : 0;
      return { merchant: merchantId, amount: Math.max(0, data.amount - share * discountAmount) };
    });
  }

  // ── Referral ─────────────────────────────────────────────────────────────────

  /**
   * Resolve a referral code to a marketer object.
   * Returns null for unknown codes or self-referrals.
   */
  async resolveMarketer(referralCode, clerkUserId) {
    if (!referralCode) return null;
    const refCode  = String(referralCode).toUpperCase().trim();
    const marketer = await Marketer.findOne({ code: refCode, status: 'active' });
    if (!marketer) return null;
    if (marketer.clerkId === clerkUserId) {
      logger.warn('Self-referral blocked', { clerkUserId });
      return null;
    }
    return { id: marketer._id, code: refCode };
  }

  // ── Currency ─────────────────────────────────────────────────────────────────

  /**
   * Convert USD order totals into the user's selected currency.
   * Never throws — returns nulls if conversion fails so the order still goes through.
   */
  async resolveCurrencyConversions(totals, currencyCode, fxSnapshot) {
    if (!currencyCode || currencyCode.toUpperCase() === 'USD') {
      return { totalAmountConverted: null, discountAmountConverted: null, finalAmountConverted: null };
    }
    try {
      const currency = await Currency.findOne({ code: currencyCode.toUpperCase() }).lean();
      const rate     = fxSnapshot?.rate || 1;
      return {
        totalAmountConverted:    applyPsychologicalPricing(totals.totalAmount    * rate, currency),
        discountAmountConverted: applyPsychologicalPricing(totals.discountAmount * rate, currency),
        finalAmountConverted:    applyPsychologicalPricing(totals.finalAmount    * rate, currency),
      };
    } catch (err) {
      logger.warn('Currency conversion failed — order saved in USD', { error: err.message });
      return { totalAmountConverted: null, discountAmountConverted: null, finalAmountConverted: null };
    }
  }

  // ── Main entry point ─────────────────────────────────────────────────────────

  /**
   * Create a new order from the authenticated user's current cart.
   *
   * Responsibility matrix:
   *   ✓ User + cart loading
   *   ✓ Atomic order number generation
   *   ✓ Address resolution + ownership enforcement
   *   ✓ Cart → line items (stock validation)
   *   ✓ Coupon validation + atomic reservation (via CouponService)
   *   ✓ Marketer discount lookup
   *   ✓ Merchant revenue distribution
   *   ✓ Referral marketer linking + self-referral prevention
   *   ✓ FX snapshot + currency conversion (best-effort)
   *   ✓ Single Order.create() — no post-create .save() calls
   *   ✓ Post-create side-effects: coupon usage log, referral tracking, cart clear
   *
   * NOT responsible for (controller concern):
   *   ✗ Reading req / sending res
   *   ✗ transferProof URL domain validation (HTTP boundary check)
   *   ✗ Order notification emails
   *   ✗ Push notification dispatch
   *
   * @param {string} clerkUserId   - Authenticated Clerk user ID
   * @param {Object} body          - Validated request body
   * @param {string} clientIp      - Client IP (for referral tracking log)
   * @returns {{ order, emailPayload }} - Order doc + data needed for confirmation email
   * @throws  ServiceError on any business-logic validation failure
   */
  async createOrder(clerkUserId, body, clientIp) {
    // 1. Load user
    const user = await User.findOne({ clerkId: clerkUserId });
    if (!user) throw new ServiceError('User not found', 'USER_NOT_FOUND', 404);

    // 2. Atomic order number
    const counter     = await Counter.findOneAndUpdate(
      { _id: 'orderNumber' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const orderNumber = `ORD-${String(counter.seq).padStart(4, '0')}`;

    // 3. Load cart (with populated products + their merchants)
    const cart = await Cart.findOne({ user: user._id }).populate({
      path: 'products.product',
      populate: { path: 'merchant' },
    });
    if (!cart || cart.products.length === 0) {
      throw new ServiceError('Cart is empty or not found', 'EMPTY_CART');
    }

    // 4. Resolve shipping address
    let { addressText, phoneNumber, city } = body.addressId
      ? await this.resolveAddress(String(body.addressId), user._id)
      : {
          addressText: String(body.shippingAddress || '').trim(),
          phoneNumber:  String(body.phoneNumber    || '').trim(),
          city:         String(body.city           || '').trim(),
        };

    if (!addressText || addressText.length < 10 || addressText.length > 500) {
      throw new ServiceError('Shipping address must be between 10 and 500 characters', 'VALIDATION_ERROR', 400, [
        { field: 'shippingAddress', message: 'Must be between 10 and 500 characters' },
      ]);
    }
    if (!phoneNumber || phoneNumber.length < 5 || phoneNumber.length > 20) {
      throw new ServiceError('Phone number must be between 5 and 20 characters', 'VALIDATION_ERROR', 400, [
        { field: 'phoneNumber', message: 'Must be between 5 and 20 characters' },
      ]);
    }
    if (!city) city = 'غير محدد';

    // 5. Build order line items + validate stock
    const {
      orderProducts,
      totalAmount,
      merchantMap,
      merchantIds,
      merchantTotalAmount,
      platformTotalAmount,
      unmerchantedProducts,
    } = this.buildOrderItems(cart.products);

    if (unmerchantedProducts.length > 0) {
      logger.warn('Order contains products without merchants', {
        orderNumber,
        count: unmerchantedProducts.length,
        products: unmerchantedProducts.map(p => ({ id: p.product.toString(), name: p.name })),
      });
    }

    // 6. Apply discounts
    let discountAmount = 0;
    let couponId       = null;
    let couponDetails  = null;

    if (body.couponCode) {
      const result   = await couponService.reserveCoupon(body.couponCode, user._id, totalAmount);
      discountAmount += result.discountAmount;
      couponId        = result.couponId;
      couponDetails   = result.couponDetails;
    }

    if (body.marketerCode) {
      const marketerDiscount = await couponService.getMarketerDiscount(body.marketerCode, totalAmount);
      discountAmount = Math.min(discountAmount + marketerDiscount, totalAmount);
    }

    const finalAmount = Math.max(0, totalAmount - discountAmount);

    // 7. Merchant revenue distribution
    const merchantRevenue = this.buildMerchantRevenue(merchantMap, merchantTotalAmount, discountAmount);

    if (merchantTotalAmount + platformTotalAmount !== totalAmount) {
      logger.error('Order amount mismatch detected', {
        orderNumber, totalAmount, merchantTotalAmount, platformTotalAmount,
        diff: totalAmount - (merchantTotalAmount + platformTotalAmount),
      });
    }

    // 8. Validate payment method
    const paymentMethod = normalizePaymentMethod(body.paymentMethod);
    if (!paymentMethod) {
      throw new ServiceError(
        'Invalid payment method — use CASH, BANKAK or CARD',
        'INVALID_PAYMENT_METHOD',
        400
      );
    }

    // 9. Pre-resolve referral marketer + currency (parallel)
    const selectedCurrency = body.currencyCode || user.currencyCode || 'USD';
    const [resolvedMarketer, fxSnapshot] = await Promise.all([
      this.resolveMarketer(body.referralCode || null, clerkUserId),
      getFxSnapshotForOrder(selectedCurrency),
    ]);

    const currencyConversions = await this.resolveCurrencyConversions(
      { totalAmount, discountAmount, finalAmount },
      selectedCurrency,
      fxSnapshot
    );

    // 10. Create the order — single DB write
    const order = await Order.create({
      user:    user._id,
      products: orderProducts,
      totalAmount,
      discountAmount,
      finalAmount,
      coupon:         couponId,
      couponDetails:  couponDetails || null,
      paymentMethod,
      paymentStatus:  'pending',
      orderNumber,
      address:         addressText,
      phoneNumber,
      city,
      transferProof:   body.transferProof || body.paymentProofUrl || null,
      marketer:          resolvedMarketer?.id   || null,
      referralCodeUsed:  resolvedMarketer?.code || null,
      marketerCommission: 0,
      merchants:      Array.from(merchantIds),
      merchantRevenue,
      currencyCodeSelected: selectedCurrency,
      fxSnapshot,
      ...currencyConversions,
    });

    // 11. Post-create side-effects (fire-and-forget — must not block the response)
    if (couponId) {
      CouponUsage.create({ coupon: couponId, user: user._id, order: order._id }).catch(err =>
        logger.error('Failed to record coupon usage', { error: err.message, orderId: order._id })
      );
    }

    if (resolvedMarketer) {
      ReferralTrackingLog.findOneAndUpdate(
        { referralCode: resolvedMarketer.code, ip: clientIp, converted: false },
        { $set: { converted: true, orderId: order._id } },
        { sort: { createdAt: -1 } }
      ).catch(err =>
        logger.error('Failed to link referral tracking log', { error: err.message })
      );
    }

    await Cart.findOneAndDelete({ user: user._id });

    // 12. Build email payload BEFORE returning (cart is now cleared)
    const emailPayload = {
      to:          user.emailAddress,
      userName:    user.fullName || '',
      orderNumber,
      totalAmount: finalAmount,
      products:    cart.products.map(item => {
        let attrs = {};
        if (item.attributes instanceof Map) attrs = mapToObject(item.attributes);
        else if (item.size) attrs = { size: item.size };
        return {
          name:     item.product.name,
          quantity: item.quantity,
          price:    getProductPrice(item.product, attrs),
        };
      }),
    };

    return { order, emailPayload };
  }
}

export default new OrderService();
