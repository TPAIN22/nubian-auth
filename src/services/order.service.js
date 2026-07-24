import Order from '../models/orders.model.js';
import Cart from '../models/carts.model.js';
import Address from '../models/address.model.js';
import Counter from '../models/counter.model.js';
import Marketer from '../models/marketer.model.js';
import ReferralTrackingLog from '../models/referralTrackingLog.model.js';
import CouponUsage from '../models/couponUsage.model.js';
import Product from '../models/product.model.js';
import User from '../models/user.model.js';
import couponService from './coupon.service.js';
import {
  getFxSnapshotForOrder,
  getCurrencyContext,
  convertAmount,
  convertLineTotals,
} from './currency.service.js';
import { getProductPrice, mapToObject } from '../utils/cartUtils.js';
import { calculateFinalPrice } from '../lib/pricing.engine.js';
import { ServiceError } from '../lib/errors.js';
import { buildShippingAddressText, toAddressSnapshot } from '../lib/address.js';
import { LOCATION_SOURCE } from '../services/geo/types.js';
import logger from '../lib/logger.js';

// ─── Private helpers (no HTTP knowledge) ─────────────────────────────────────

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
   * Returns both the flat legacy fields (still written to every order) and an
   * immutable snapshot, so the order stops depending on the saved address the
   * moment it is placed.
   *
   * @returns {{ addressText, phoneNumber, city, addressSnapshot }}
   * @throws  ServiceError if address not found or not owned by user
   */
  async resolveAddress(addressId, userId) {
    if (!addressId) {
      return { addressText: '', phoneNumber: '', city: '', addressSnapshot: undefined };
    }

    const addr = await Address.findOne({ _id: addressId, user: userId });
    if (!addr) {
      throw new ServiceError('Address not found', 'ADDRESS_NOT_FOUND', 400, [
        { field: 'addressId', message: 'Invalid or inaccessible addressId', value: String(addressId) },
      ]);
    }

    const snapshot = toAddressSnapshot(addr);

    return {
      addressText: buildShippingAddressText(addr),
      phoneNumber: String(addr.phone || addr.whatsapp || '').trim(),
      // v2 addresses carry a geocoded city; v1 rows fall back to the hierarchy
      // name. Either way `city` on the order stays populated as it always was.
      city:        String(addr.city || addr.cityName || snapshot.city || '').trim(),
      addressSnapshot: snapshot,
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

      let itemAttributes = {};
      if (item.attributes instanceof Map) {
        itemAttributes = mapToObject(item.attributes);
      } else if (item.attributes && typeof item.attributes === 'object') {
        itemAttributes = item.attributes;
      } else if (item.size) {
        itemAttributes = { size: item.size };
      }

      const itemVariant = item.variantId ? item.product.variants?.id(item.variantId) : null;

      // Stock check: prefer variant stock when a variant is selected; otherwise
      // sum live variant stocks (never the cached `product.stock` rollup —
      // findOneAndUpdate paths skip the pre-save hook that maintains it).
      const liveProductStock = Array.isArray(item.product.variants)
        ? item.product.variants.reduce(
            (sum, v) => sum + (v.isActive !== false ? (v.stock || 0) : 0),
            0,
          )
        : (item.product.stock || 0);
      const availableStock = itemVariant ? (itemVariant.stock || 0) : liveProductStock;

      if (availableStock < item.quantity) {
        logger.warn('Stock check failed', {
          productId:        String(item.product._id),
          productName:      item.product.name,
          requestedQty:     item.quantity,
          requestedVariant: item.variantId ? String(item.variantId) : null,
          variantResolved:  Boolean(itemVariant),
          variantStock:     itemVariant ? itemVariant.stock : null,
          variantIsActive:  itemVariant ? itemVariant.isActive : null,
          cachedProductStock: item.product.stock,
          liveProductStock,
          variantCount:     Array.isArray(item.product.variants) ? item.product.variants.length : 0,
        });
        throw new ServiceError(
          `"${item.product.name}" only has ${availableStock} unit(s) in stock`,
          'INSUFFICIENT_STOCK'
        );
      }

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
          merchantPrice: pricing.basePrice,
          nubianMarkup:  pricing.breakdown.nubianMarkup,
          dynamicMarkup: pricing.breakdown.dynamicMarkup,
        });
      } else {
        platformTotalAmount += itemTotal;
        unmerchantedProducts.push({
          product:       item.product._id,
          name:          item.product.name,
          quantity:      item.quantity,
          price:         itemPrice,
          merchantPrice: pricing.basePrice,
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
   *
   * The total is built by converting each line's UNIT price and then multiplying
   * by quantity (see convertLineTotals) rather than converting the aggregate.
   * That's what the cart/checkout screens show the shopper, and converting the
   * aggregate instead is exactly what made the dashboard total drift from the
   * app total by a few units per line.
   *
   * @param {Object} args
   * @param {Array}  args.orderProducts - order line items (USD `price`, `quantity`)
   * @param {number} args.discountAmount - USD discount already applied
   */
  async resolveCurrencyConversions({ orderProducts, discountAmount }, currencyCode, context) {
    if (!currencyCode || currencyCode.toUpperCase() === 'USD') {
      return { totalAmountConverted: null, discountAmountConverted: null, finalAmountConverted: null };
    }
    try {
      const ctx = context || (await getCurrencyContext(currencyCode));

      const { total: totalAmountConverted } = convertLineTotals(
        (orderProducts || []).map((p) => ({ unitPrice: p.price, quantity: p.quantity })),
        ctx,
      );

      const discountAmountConverted = discountAmount > 0 ? convertAmount(discountAmount, ctx) : 0;

      return {
        totalAmountConverted,
        discountAmountConverted,
        // Derived by subtraction rather than converted on its own, so the stored
        // order always satisfies final = total − discount in the shopper's
        // currency. Converting finalAmount independently lets rounding break
        // that identity and the dashboard shows three numbers that don't add up.
        finalAmountConverted: Math.max(0, totalAmountConverted - discountAmountConverted),
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
    let { addressText, phoneNumber, city, addressSnapshot } = body.addressId
      ? await this.resolveAddress(String(body.addressId), user._id)
      : {
          // Legacy free-text path — still supported for any client that has not
          // moved to addressId.
          addressText: String(body.shippingAddress || '').trim(),
          phoneNumber:  String(body.phoneNumber    || '').trim(),
          city:         String(body.city           || '').trim(),
          // Built below, once the text has been validated.
          addressSnapshot: undefined,
        };

    // A map-first address is defined by its pin, not its prose: a shopper can
    // legitimately drop a pin on an unnamed street where the geocoder returns
    // nothing and they add no building detail. That address is deliverable, so
    // the legacy 10-character minimum must not reject it — instead give the
    // order a readable line derived from the coordinates.
    const snapshotCoords = addressSnapshot?.location?.coordinates;
    if (Array.isArray(snapshotCoords) && snapshotCoords.length === 2) {
      const [lng, lat] = snapshotCoords;
      const pinLine = `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      addressText = addressText.length >= 10 ? addressText : [addressText, pinLine].filter(Boolean).join(' - ');
    }

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

    // Every order gets a snapshot — no exceptions.
    //
    // The free-text path has no saved address to freeze, but an order with no
    // snapshot forces every downstream consumer to keep a second code path
    // alive forever. Building one from the posted text costs nothing and means
    // "read addressSnapshot" is always correct. It is honestly marked `legacy`
    // / `low` confidence with no coordinates, because that is exactly what it is.
    if (!addressSnapshot) {
      addressSnapshot = toAddressSnapshot({
        name: String(body.name || '').trim(),
        phone: phoneNumber,
        formattedAddress: addressText,
        city,
        locationSource: LOCATION_SOURCE.LEGACY,
      });
    }

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
    const [resolvedMarketer, currencyContext] = await Promise.all([
      this.resolveMarketer(body.referralCode || null, clerkUserId),
      getCurrencyContext(selectedCurrency),
    ]);

    // Snapshot and conversion share one context, so the rate recorded on the
    // order is the rate the stored amounts were actually computed with.
    const fxSnapshot = await getFxSnapshotForOrder(selectedCurrency, currencyContext);

    const currencyConversions = await this.resolveCurrencyConversions(
      { orderProducts, discountAmount },
      selectedCurrency,
      currencyContext
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
      addressSnapshot,
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

  // ── Quote (preview totals, no DB write) ─────────────────────────────────────

  /**
   * Compute checkout totals + per-merchant breakdown for the given items
   * without creating an order. Used by the mobile checkout sheet so the user
   * sees authoritative pricing before confirming.
   *
   * Shipping is not yet modelled — fee is 0 and rate is null. Wire in a real
   * ShippingRate lookup here once the model exists.
   *
   * @param {Object} userDoc       - The User document (req.appUser)
   * @param {string} addressId     - Address ObjectId
   * @param {Array}  items         - [{ productId, quantity, variantId?, attributes? }]
   * @param {string} currencyCode  - Currency to report in the response
   */
  async quoteOrder(userDoc, addressId, items, currencyCode = 'USD') {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ServiceError('items must be a non-empty array', 'EMPTY_ITEMS');
    }

    const address = await Address.findOne({ _id: addressId, user: userDoc._id });
    if (!address) {
      throw new ServiceError('Address not found', 'ADDRESS_NOT_FOUND', 400, [
        { field: 'addressId', message: 'Invalid or inaccessible addressId', value: String(addressId) },
      ]);
    }

    const productIds = items
      .map((i) => i?.productId)
      .filter(Boolean);
    if (productIds.length !== items.length) {
      throw new ServiceError('Every item requires a productId', 'INVALID_ITEM');
    }

    const products = await Product.find({ _id: { $in: productIds } }).populate('merchant');
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    // Translate the wire-format items into the populated cart-product shape
    // buildOrderItems already understands, so the same stock + pricing rules
    // run for both quote and order creation.
    const cartLike = items.map((it) => {
      const product = productMap.get(String(it.productId));
      if (!product) {
        throw new ServiceError(
          'A product in your cart is no longer available',
          'PRODUCT_UNAVAILABLE'
        );
      }
      return {
        product,
        quantity:   Number(it.quantity) || 0,
        variantId:  it.variantId || null,
        attributes: it.attributes || {},
        size:       it.size || '',
      };
    });

    const {
      orderProducts,
      totalAmount,
      merchantMap,
      platformTotalAmount,
      unmerchantedProducts,
    } = this.buildOrderItems(cartLike);

    const shippingFee = 0;
    const shippingRate = null;

    // buildOrderItems works in USD (the pricing engine reads raw merchant prices
    // off the documents). Convert before returning — this response previously
    // shipped USD amounts stamped with the user's currency code, which is how
    // the checkout summary ended up showing unconverted totals.
    const context = await getCurrencyContext(currencyCode);
    const toDisplay = (lines) =>
      convertLineTotals(
        lines.map((p) => ({ unitPrice: p.price, quantity: p.quantity })),
        context,
      );

    const { total: subtotal } = toDisplay(orderProducts);

    // Build per-merchant breakdown that mirrors the mobile QuoteResponse shape.
    const subOrders = [];
    for (const [merchantId, data] of merchantMap.entries()) {
      const { lines, total } = toDisplay(data.products);
      subOrders.push({
        merchantId,
        items: data.products.map((p, i) => ({
          productId:     String(p.product),
          quantity:      p.quantity,
          price:         lines[i].unitPrice,
          merchantPrice: convertAmount(p.merchantPrice, context),
        })),
        subtotal:    total,
        shippingFee: 0,
        total,
      });
    }

    if (platformTotalAmount > 0) {
      const { lines, total } = toDisplay(unmerchantedProducts);
      subOrders.push({
        merchantId:  null,
        items: unmerchantedProducts.map((p, i) => ({
          productId:     String(p.product),
          quantity:      p.quantity,
          price:         lines[i].unitPrice,
          merchantPrice: convertAmount(p.merchantPrice, context),
        })),
        subtotal:    total,
        shippingFee: 0,
        total,
      });
    }

    return {
      address,
      shippingRate,
      subtotal,
      shippingFee,
      total:       subtotal + shippingFee,
      currency:    context.upperCode,

      // USD base alongside the display amounts. Coupon `value`, `maxDiscount`
      // and `minOrderAmount` are all stored in USD, so clients must send
      // `subtotalBase` — not `subtotal` — to the coupon endpoints; sending the
      // display amount makes a fixed $10 coupon behave like a 10 SDG one.
      baseCurrency: 'USD',
      subtotalBase: totalAmount,
      totalBase:    totalAmount + shippingFee,

      subOrders,
    };
  }
}

export default new OrderService();
