import Cart from "../models/carts.model.js";
import { getAuth, clerkClient } from "@clerk/express";
import User from "../models/user.model.js";
import Product from "../models/product.model.js";
import Coupon from "../models/coupon.model.js";
import CouponUsage from "../models/couponUsage.model.js";
import logger from "../lib/logger.js";
import { sendError, sendSuccess, sendNotFound, sendUnauthorized } from "../lib/response.js";
import {
  normalizeAttributes,
  mergeSizeAndAttributes,
  generateCartItemKey,
  validateRequiredAttributes,
  objectToMap,
  getItemAttributes,
  findCartItemIndex,
  findMatchingVariant,
  getProductPrice,
} from "../utils/cartUtils.js";
import { enrichProductWithPricing } from "./products.controller.js";
import { convertProductPrices, convertAndFormatPriceSync } from "../services/currency.service.js";
import Currency from "../models/currency.model.js";
import { getLatestRate } from "../services/fx.service.js";

/**
 * Helper function to get or create user in database
 * Handles cases where user exists in Clerk but not in MongoDB (webhook delay/failure)
 */
async function getOrCreateUser(clerkId, requestId) {
  let user = await User.findOne({ clerkId });
  
  if (!user) {
    logger.info('User not found in database, creating from Clerk', {
      requestId,
      clerkId,
    });
    
    try {
      // Get user data from Clerk
      const clerkUser = await clerkClient.users.getUser(clerkId);
      
      // Create user in database
      user = new User({
        clerkId: clerkUser.id,
        fullName: clerkUser.firstName && clerkUser.lastName 
          ? `${clerkUser.firstName} ${clerkUser.lastName}` 
          : clerkUser.username || clerkUser.emailAddresses?.[0]?.emailAddress || 'User',
        emailAddress: clerkUser.emailAddresses?.[0]?.emailAddress || '',
        phone: clerkUser.phoneNumbers?.[0]?.phoneNumber || '',
      });
      await user.save();
      
      logger.info('User created successfully in database', {
        requestId,
        userId: user._id,
        clerkId: clerkUser.id,
      });
    } catch (createError) {
      logger.error('Failed to create user in database', {
        requestId,
        clerkId,
        error: createError.message,
        stack: createError.stack,
      });
      throw new Error(`Failed to initialize user account: ${createError.message}`);
    }
  }
  
  return user;
}

/**
 * Convert cart prices to target currency
 * @param {Object} cartObj - The cart object
 * @param {string} currencyCode - Target currency code
 * @returns {Promise<Object>} - Converted cart object
 */
async function convertCart(cartObj, currencyCode) {
  if (!currencyCode || currencyCode.toUpperCase() === 'USD') {
    return cartObj;
  }

  try {
    const upperCode = currencyCode.toUpperCase();
    
    // Fetch rate and config ONCE
    const [currencyConfig, rateInfo] = await Promise.all([
      Currency.findOne({ code: upperCode }).lean(),
      getLatestRate(upperCode)
    ]);
    
    const currencyContext = {
      config: currencyConfig,
      rate: rateInfo
    };

    const convertScalar = (v) =>
      convertAndFormatPriceSync(v, upperCode, rateInfo, currencyConfig).priceConverted;

    // Convert total price
    if (cartObj.totalPrice !== undefined) {
      const convertedTotal = convertAndFormatPriceSync(cartObj.totalPrice, upperCode, rateInfo, currencyConfig);
      cartObj.totalPrice = convertedTotal.priceConverted;
      cartObj.priceDisplay = convertedTotal.priceDisplay;
      cartObj.currencyCode = convertedTotal.currencyCode;
    }

    // Convert breakdown fields so the client can render line items in the
    // active currency without re-deriving them from totalPrice.
    if (cartObj.subtotal !== undefined) cartObj.subtotal = convertScalar(cartObj.subtotal);
    if (cartObj.discount !== undefined) cartObj.discount = convertScalar(cartObj.discount);
    if (cartObj.shipping !== undefined) cartObj.shipping = convertScalar(cartObj.shipping);
    if (cartObj.appliedCoupon && cartObj.appliedCoupon.discountAmount !== undefined) {
      cartObj.appliedCoupon.discountAmount = convertScalar(cartObj.appliedCoupon.discountAmount);
    }

    // Convert products
    if (cartObj.products && Array.isArray(cartObj.products)) {
       cartObj.products = await Promise.all(cartObj.products.map(async (item) => {
          // Convert product
          if (item.product) {
             item.product = await convertProductPrices(item.product, upperCode, currencyContext);
          }

          // Convert unit prices if they exist on item level
          if (item.unitFinalPrice !== undefined) {
             const converted = convertAndFormatPriceSync(item.unitFinalPrice, upperCode, rateInfo, currencyConfig);
             item.unitFinalPrice = converted.priceConverted;
          }
          if (item.unitMerchantPrice !== undefined) {
             const converted = convertAndFormatPriceSync(item.unitMerchantPrice, upperCode, rateInfo, currencyConfig);
             item.unitMerchantPrice = converted.priceConverted;
          }

          return item;
       }));
    }

    return cartObj;
  } catch (error) {
    logger.warn('Cart currency conversion failed', { currencyCode, error: error.message });
    return cartObj;
  }
}

// GET USER'S CART
export const getCart = async (req, res) => {
  logger.info('Get cart request received', {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    path: req.path,
    originalUrl: req.originalUrl,
    hasAuth: !!req.auth,
    authKeys: req.auth ? Object.keys(req.auth) : [],
    headers: {
      authorization: req.headers.authorization ? 'present' : 'missing',
    },
  });

  // Try to get userId from getAuth, fallback to req.auth.userId
  const authData = getAuth(req);
  const userId = authData?.userId || req.auth?.userId;
  
  logger.info('Auth data extracted in getCart', {
    requestId: req.requestId,
    hasAuthData: !!authData,
    authDataKeys: authData ? Object.keys(authData) : [],
    userId,
    reqAuthUserId: req.auth?.userId,
  });
  
  // Check if userId is available (authentication check)
  if (!userId) {
    logger.warn('Get cart failed: No userId found', {
      requestId: req.requestId,
      hasAuth: !!req.auth,
      hasAuthData: !!authData,
      authData,
      reqAuth: req.auth,
    });
    return sendUnauthorized(res, "Authentication required.");
  }
  
  try {
    // Get or create user (handles webhook delay/failure)
    const user = await getOrCreateUser(userId, req.requestId);

    let cart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      // Return all product fields including _id, discountPrice, variants, category, merchant, etc.
      // No select() means all fields are returned (better for frontend)
    }).populate({
      path: "products.product.category",
      select: "name",
    }).populate({
      path: "products.product.merchant",
      select: "storeName email logoUrl city status",
    });

    if (!cart) {
      // Return empty cart structure instead of 404 for better UX
      return sendSuccess(res, {
        data: {
          products: [],
          totalQuantity: 0,
          subtotal: 0,
          discount: 0,
          shipping: 0,
          totalPrice: 0,
          appliedCoupon: null,
        },
        message: "Cart is empty",
      });
    }

    // Convert to plain object to modify
    const cartObj = cart.toObject();

    // Enrich products with definitive pricing
    if (cartObj.products) {
      cartObj.products = cartObj.products.map(item => {
        if (item.product) {
          item.product = enrichProductWithPricing(item.product);
        }
        return item;
      });
    }

    // Apply currency conversion
    const currencyCode = req.currencyCode;
    if (currencyCode && currencyCode.toUpperCase() !== 'USD') {
       await convertCart(cartObj, currencyCode);
    }

    return sendSuccess(res, {
      data: cartObj,
      message: "Cart retrieved successfully",
    });
  } catch (error) {
    logger.error('Error fetching cart', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    return sendError(res, {
      message: "Server error while fetching cart.",
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });
  }
};

// ADD PRODUCT TO CART
// ADD PRODUCT TO CART
// ADD PRODUCT TO CART
export const addToCart = async (req, res) => {
  try {
    logger.info('Add to cart request received', {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      path: req.path,
      originalUrl: req.originalUrl,
      hasAuth: !!req.auth,
      authKeys: req.auth ? Object.keys(req.auth) : [],
      headers: {
        authorization: req.headers.authorization ? 'present' : 'missing',
        'content-type': req.headers['content-type'],
      },
      body: {
        productId: req.body?.productId,
        quantity: req.body?.quantity,
        size: req.body?.size,
      },
    });

    // Try to get userId from getAuth, fallback to req.auth.userId
    const authData = getAuth(req);
    const userId = authData?.userId || req.auth?.userId;

    logger.info('Auth data extracted', {
      requestId: req.requestId,
      hasAuthData: !!authData,
      authDataKeys: authData ? Object.keys(authData) : [],
      userId,
      reqAuthUserId: req.auth?.userId,
    });

    // Check if userId is available (authentication check)
    if (!userId) {
      logger.warn('Add to cart failed: No userId found', {
        requestId: req.requestId,
        hasAuth: !!req.auth,
        hasAuthData: !!authData,
        authData,
        reqAuth: req.auth,
      });
      return sendUnauthorized(res, "Authentication required.");
    }

    const { productId, quantity, size, attributes } = req.body;
    
    // Merge legacy size with new attributes format for backward compatibility
    const mergedAttributes = mergeSizeAndAttributes(size, attributes);

    // Basic input validation
    if (!productId || !quantity) {
      logger.warn('Add to cart failed: Missing required fields', {
        requestId: req.requestId,
        userId,
        hasProductId: !!productId,
        hasQuantity: !!quantity,
      });
      return sendError(res, {
        message: "Product ID and quantity are required.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }
    if (typeof quantity !== "number" || quantity <= 0) {
      logger.warn('Add to cart failed: Invalid quantity', {
        requestId: req.requestId,
        userId,
        productId,
        quantity,
        quantityType: typeof quantity,
      });
      return sendError(res, {
        message: "Quantity must be a positive number.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    // Get or create user (handles webhook delay/failure)
    let user;
    try {
      user = await getOrCreateUser(userId, req.requestId);
    } catch (createError) {
      logger.error('Failed to get or create user', {
        requestId: req.requestId,
        userId,
        error: createError.message,
      });
      return sendError(res, {
        message: "Failed to initialize user account. Please try again.",
        code: "USER_CREATION_FAILED",
        statusCode: 500,
      });
    }

    // Check if the product exists and get its price
    const productExists = await Product.findById(productId);
    if (!productExists) {
      logger.warn('Add to cart failed: Product not found', {
        requestId: req.requestId,
        userId,
        productId,
      });
      return sendNotFound(res, "Product");
    }

    // Validate required attributes if product has attribute definitions
    if (productExists.attributes && Array.isArray(productExists.attributes) && productExists.attributes.length > 0) {
      const validation = validateRequiredAttributes(productExists.attributes, mergedAttributes);
      if (!validation.valid) {
        logger.warn('Add to cart failed: Missing required attributes', {
          requestId: req.requestId,
          userId,
          productId,
          missing: validation.missing,
        });
        return sendError(res, {
          message: `Missing required attributes: ${validation.missing.join(', ')}`,
          code: "VALIDATION_ERROR",
          statusCode: 400,
          details: { missingAttributes: validation.missing },
        });
      }
    }

    // For variant-based products, validate that a matching variant exists
    let variantId = null;
    let matchingVariant = null;
    if (productExists.variants && Array.isArray(productExists.variants) && productExists.variants.length > 0) {
      if (Object.keys(mergedAttributes).length > 0) {
        matchingVariant = findMatchingVariant(productExists, mergedAttributes);
        if (!matchingVariant) {
          logger.warn('Add to cart failed: No matching variant found', {
            requestId: req.requestId,
            userId,
            productId,
            attributes: mergedAttributes,
          });
          return sendError(res, {
            message: "No matching variant found for the selected attributes.",
            code: "VALIDATION_ERROR",
            statusCode: 400,
            details: { attributes: mergedAttributes },
          });
        }
        variantId = matchingVariant._id;
        if (!matchingVariant.isActive || matchingVariant.stock <= 0) {
          logger.warn('Add to cart failed: Variant not available', {
            requestId: req.requestId,
            userId,
            productId,
            variantSku: matchingVariant.sku,
            isActive: matchingVariant.isActive,
            stock: matchingVariant.stock,
          });
          return sendError(res, {
            message: "Selected variant is not available.",
            code: "VALIDATION_ERROR",
            statusCode: 400,
          });
        }
      }
    }

    // Get the correct price (variant price if variant exists, otherwise product price)
    const itemPrice = getProductPrice(productExists, mergedAttributes);
    const itemMerchantPrice = matchingVariant ? (matchingVariant.merchantPrice || matchingVariant.price || 0) : (productExists.merchantPrice || productExists.price || 0);
    
    if (!itemPrice || itemPrice <= 0) {
      logger.warn('Add to cart failed: Invalid price', {
        requestId: req.requestId,
        userId,
        productId,
        price: itemPrice,
        hasVariants: !!(productExists.variants && productExists.variants.length > 0),
      });
      return sendError(res, {
        message: "Product price is invalid. Please contact support.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    // Find the user's cart
    // **مهم:** لا تقم بعمل populate هنا. نحتاج إلى الـ ObjectId الخام للمقارنة.
    let cart = await Cart.findOne({ user: user._id });

    // Generate cart item key for comparison
    const newItemKey = generateCartItemKey(productId.toString(), mergedAttributes);

    // If no cart exists, create a new one
    if (!cart) {
      const attributesMap = objectToMap(mergedAttributes);
      const newCart = new Cart({
        user: user._id,
        products: [{
          product: productId,
          variantId,
          quantity,
          size: mergedAttributes.size || '', // Keep legacy size for backward compatibility
          attributes: attributesMap,
          unitFinalPrice: itemPrice,
          unitMerchantPrice: itemMerchantPrice,
        }],
        totalQuantity: quantity,
        totalPrice: itemPrice * quantity,
      });
      await newCart.save();

      // Populate the newly created cart before sending it back
      const populatedCart = await Cart.findById(newCart._id).populate({
        path: "products.product",
        // Return all product fields
      }).populate({
        path: "products.product.category",
        select: "name",
      }).populate({
        path: "products.product.merchant",
        select: "storeName email logoUrl city status",
      });
      return sendSuccess(res, {
        data: populatedCart,
        message: "Product added to cart successfully",
        statusCode: 201,
      });
    }

    // If cart exists, check if the product with the same attributes is already in it
    const productIndex = findCartItemIndex(cart.products, productId, mergedAttributes);

    if (productIndex > -1) {
      // Product with the same ID and attributes exists, update its quantity
      cart.products[productIndex].quantity += quantity;
      cart.products[productIndex].unitFinalPrice = itemPrice;
      cart.products[productIndex].unitMerchantPrice = itemMerchantPrice;
      cart.products[productIndex].variantId = variantId;
    } else {
      // Product not found or has different attributes, add it as a new item
      const attributesMap = objectToMap(mergedAttributes);
      cart.products.push({
        product: productId,
        variantId,
        quantity,
        size: mergedAttributes.size || '', // Keep legacy size for backward compatibility
        attributes: attributesMap,
        unitFinalPrice: itemPrice,
        unitMerchantPrice: itemMerchantPrice,
      });
    }

    // Recalculate total quantity and total price for the entire cart
    cart.totalQuantity = cart.products.reduce(
      (acc, item) => acc + item.quantity,
      0
    );

    for (const item of cart.products) {
      // Fetch product to get its current price (important if prices change)
      const p = await Product.findById(item.product);
      if (p) {
        const itemAttributes = getItemAttributes(item);
        item.unitFinalPrice = getProductPrice(p, itemAttributes);
      }
    }
    // pre('save') derives subtotal/discount/totalPrice from the (now-fresh)
    // unitFinalPrice values and the appliedCoupon snapshot.

    // Save the updated cart
    await cart.save();

    // Populate the updated cart before sending the response
    // Populate the updated cart before sending the response
    const populatedCart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      // Return all product fields
    }).populate({
      path: "products.product.category",
      select: "name",
    }).populate({
      path: "products.product.merchant",
      select: "storeName email logoUrl city status",
    });

    // Enriched Response
    const cartObj = populatedCart.toObject();
    if (cartObj.products) {
        cartObj.products = cartObj.products.map(item => {
            if (item.product) {
                item.product = enrichProductWithPricing(item.product);
            }
            return item;
        });
    }

    // Apply currency conversion
    const currencyCode = req.currencyCode;
    if (currencyCode && currencyCode.toUpperCase() !== 'USD') {
       await convertCart(cartObj, currencyCode);
    }

    return sendSuccess(res, {
      data: cartObj,
      message: "Product added to cart successfully",
    });
  } catch (error) {
    logger.error('Error adding to cart', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    return sendError(res, {
      message: "Server error while adding item to cart.",
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });
  }
};


export const updateCart = async (req, res) => {
  // Try to get userId from getAuth, fallback to req.auth.userId
  const authData = getAuth(req);
  const userId = authData?.userId || req.auth?.userId;
  
  // Check if userId is available (authentication check)
  if (!userId) {
    return res.status(401).json({ message: "Authentication required." });
  }
  
  const { productId, quantity, size, attributes } = req.body;
  
  // Merge legacy size with new attributes format
  const mergedAttributes = mergeSizeAndAttributes(size, attributes);

  if (!productId || !quantity) {
    return res
      .status(400)
      .json({ message: "Product ID and quantity are required." });
  }
  if (typeof quantity !== "number" || quantity === 0) {
    return res.status(400).json({ message: "Quantity change must provided." });
  }

  try {
    // Get or create user (handles webhook delay/failure)
    const user = await getOrCreateUser(userId, req.requestId);
    const cart = await Cart.findOne({ user: user._id });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found for this user." });
    }

    const productIndex = findCartItemIndex(cart.products, productId, mergedAttributes);

    if (productIndex === -1) {
      logger.warn('Cart update: product not found in cart', {
        requestId: req.requestId,
        userId: user._id.toString(),
        productId: String(productId),
        requestedAttributes: mergedAttributes,
        cartContents: cart.products.map((p) => ({
          product: (p.product && p.product._id ? p.product._id : p.product)?.toString(),
          attributes: getItemAttributes(p),
          quantity: p.quantity,
        })),
      });
      return sendError(res, {
        message: "Product not found in the cart.",
        code: "CART_ITEM_NOT_FOUND",
        statusCode: 404,
      });
    }
    const currentItem = cart.products[productIndex];
    const newQuantity = currentItem.quantity + quantity;
    if (newQuantity <= 0) {
      cart.products.splice(productIndex, 1);
      
      
    } else {
      cart.products[productIndex].quantity = newQuantity;
    }
    cart.totalQuantity = cart.products.reduce(
      (acc, item) => acc + item.quantity,
      0
    );
    for (const item of cart.products) {
      const p = await Product.findById(item.product);
      if (p) {
        const itemAttributes = getItemAttributes(item);
        item.unitFinalPrice = getProductPrice(p, itemAttributes);
      }
    }
    // pre('save') derives subtotal/discount/totalPrice.
    await cart.save();
    const populatedCart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      // Return all product fields
    }).populate({
      path: "products.product.category",
      select: "name",
    }).populate({
      path: "products.product.merchant",
      select: "storeName email logoUrl city status",
    });

    // Enriched Response
    const cartObj = populatedCart.toObject();
    if (cartObj.products) {
        cartObj.products = cartObj.products.map(item => {
            if (item.product) {
                item.product = enrichProductWithPricing(item.product);
            }
            return item;
        });
    }

    // Apply currency conversion
    const currencyCode = req.currencyCode;
    if (currencyCode && currencyCode.toUpperCase() !== 'USD') {
       await convertCart(cartObj, currencyCode);
    }

    res.status(200).json(cartObj);
  } catch (error) {
    logger.error('Error in updateCart', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    res
      .status(500)
      .json({
        message: "Server error while updating cart.",
      });
  }
};
export const removeFromCart = async (req, res) => {
  // Try to get userId from getAuth, fallback to req.auth.userId
  const authData = getAuth(req);
  const userId = authData?.userId || req.auth?.userId;
  
  // Check if userId is available (authentication check)
  if (!userId) {
    return res.status(401).json({ message: "Authentication required." });
  }
  
  const { productId, size, attributes } = req.body;
  
  // Merge legacy size with new attributes format
  const mergedAttributes = mergeSizeAndAttributes(size, attributes);

  if (!productId) {
    return res
      .status(400)
      .json({ message: "Product ID is required to remove from cart." });
  }

  try {
    // Get or create user (handles webhook delay/failure)
    const user = await getOrCreateUser(userId, req.requestId);
    const cart = await Cart.findOne({ user: user._id });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found for this user." });
    }

    const initialLength = cart.products.length;
    const removeIndex = findCartItemIndex(cart.products, productId, mergedAttributes);
    if (removeIndex > -1) {
      cart.products.splice(removeIndex, 1);
    }

    if (cart.products.length === initialLength) {
      return res
        .status(404)
        .json({
          message: "Product not found in cart with the specified size.",
        });
    }

    cart.totalQuantity = cart.products.reduce(
      (acc, item) => acc + item.quantity,
      0
    );

    for (const item of cart.products) {
      const p = await Product.findById(item.product);
      if (p) {
        const itemAttributes = getItemAttributes(item);
        item.unitFinalPrice = getProductPrice(p, itemAttributes);
      }
    }
    // pre('save') derives subtotal/discount/totalPrice.

    await cart.save();

    const populatedCart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      // Return all product fields
    }).populate({
      path: "products.product.category",
      select: "name",
    }).populate({
      path: "products.product.merchant",
      select: "storeName email logoUrl city status",
    });

    // Enriched Response
    const cartObj = populatedCart.toObject();
    if (cartObj.products) {
        cartObj.products = cartObj.products.map(item => {
            if (item.product) {
                item.product = enrichProductWithPricing(item.product);
            }
            return item;
        });
    }

    // Apply currency conversion
    const currencyCode = req.currencyCode;
    if (currencyCode && currencyCode.toUpperCase() !== 'USD') {
       await convertCart(cartObj, currencyCode);
    }

    return sendSuccess(res, {
      data: cartObj,
      message: "Product removed from cart successfully",
    });
  } catch (error) {
    logger.error('Error in removeFromCart', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    return sendError(res, {
      message: "Server error while removing item from cart.",
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });
  }
};

/**
 * Populate + enrich + currency-convert a cart, returning the response shape
 * the mobile/dashboard clients expect. Used by every cart-mutating endpoint.
 */
async function buildCartResponse(userObjectId, req) {
  const populatedCart = await Cart.findOne({ user: userObjectId }).populate({
    path: "products.product",
  }).populate({
    path: "products.product.category",
    select: "name",
  }).populate({
    path: "products.product.merchant",
    select: "storeName email logoUrl city status",
  });
  if (!populatedCart) return null;

  const cartObj = populatedCart.toObject();
  if (cartObj.products) {
    cartObj.products = cartObj.products.map((item) => {
      if (item.product) item.product = enrichProductWithPricing(item.product);
      return item;
    });
  }

  const currencyCode = req.currencyCode;
  if (currencyCode && currencyCode.toUpperCase() !== 'USD') {
    await convertCart(cartObj, currencyCode);
  }
  return cartObj;
}

// APPLY COUPON
// Validates the coupon (date/limit/per-user/min-order) without reserving it,
// then snapshots type/value/maxDiscount/minOrderAmount onto the cart so the
// pre('save') hook can recompute the discount as items change. Reservation
// (incrementing usageCount, writing CouponUsage) happens at checkout, not here.
export const applyCoupon = async (req, res) => {
  const authData = getAuth(req);
  const userId = authData?.userId || req.auth?.userId;
  if (!userId) return sendUnauthorized(res, "Authentication required.");

  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return sendError(res, {
      message: "Coupon code is required.",
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }

  try {
    const user = await getOrCreateUser(userId, req.requestId);
    const cart = await Cart.findOne({ user: user._id });
    if (!cart) {
      return sendNotFound(res, "Cart");
    }

    const upperCode = code.toUpperCase().trim();
    const coupon = await Coupon.findOne({ code: upperCode, isActive: true });
    if (!coupon) {
      return sendError(res, {
        message: "Invalid or inactive coupon code.",
        code: "INVALID_COUPON",
        statusCode: 400,
      });
    }

    const now = new Date();
    if ((coupon.startDate || new Date(0)) > now) {
      return sendError(res, {
        message: "Coupon is not yet active.",
        code: "COUPON_NOT_ACTIVE",
        statusCode: 400,
      });
    }
    if (coupon.endDate && coupon.endDate < now) {
      return sendError(res, {
        message: "Coupon has expired.",
        code: "COUPON_EXPIRED",
        statusCode: 400,
      });
    }
    if (coupon.usageLimitGlobal !== null && coupon.usageCount >= coupon.usageLimitGlobal) {
      return sendError(res, {
        message: "Coupon usage limit reached.",
        code: "COUPON_EXHAUSTED",
        statusCode: 400,
      });
    }
    if (coupon.usageLimitPerUser > 0) {
      const used = await CouponUsage.countDocuments({ coupon: coupon._id, user: user._id });
      if (used >= coupon.usageLimitPerUser) {
        return sendError(res, {
          message: "You have already used this coupon the maximum allowed times.",
          code: "COUPON_USER_LIMIT",
          statusCode: 400,
        });
      }
    }
    if (coupon.minOrderAmount > 0 && cart.subtotal < coupon.minOrderAmount) {
      return sendError(res, {
        message: `Minimum order amount of ${coupon.minOrderAmount} required.`,
        code: "COUPON_MIN_ORDER",
        statusCode: 400,
        details: { minOrderAmount: coupon.minOrderAmount, subtotal: cart.subtotal },
      });
    }

    cart.appliedCoupon = {
      couponId:       coupon._id,
      code:           coupon.code,
      type:           coupon.type,
      value:          coupon.value,
      maxDiscount:    coupon.maxDiscount,
      minOrderAmount: coupon.minOrderAmount,
      discountAmount: 0, // pre('save') will compute against current subtotal
    };
    await cart.save();

    const cartObj = await buildCartResponse(user._id, req);
    return sendSuccess(res, {
      data: cartObj,
      message: "Coupon applied successfully.",
    });
  } catch (error) {
    logger.error('Error applying coupon', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    return sendError(res, {
      message: "Server error while applying coupon.",
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });
  }
};

// REMOVE COUPON
export const removeCoupon = async (req, res) => {
  const authData = getAuth(req);
  const userId = authData?.userId || req.auth?.userId;
  if (!userId) return sendUnauthorized(res, "Authentication required.");

  try {
    const user = await getOrCreateUser(userId, req.requestId);
    const cart = await Cart.findOne({ user: user._id });
    if (!cart) return sendNotFound(res, "Cart");

    cart.appliedCoupon = null;
    await cart.save();

    const cartObj = await buildCartResponse(user._id, req);
    return sendSuccess(res, {
      data: cartObj,
      message: "Coupon removed.",
    });
  } catch (error) {
    logger.error('Error removing coupon', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    return sendError(res, {
      message: "Server error while removing coupon.",
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });
  }
};
