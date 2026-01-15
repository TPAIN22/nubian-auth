import Cart from "../models/carts.model.js";
import { getAuth, clerkClient } from "@clerk/express";
import User from "../models/user.model.js";
import Product from "../models/product.model.js";
import logger from "../lib/logger.js";
import { sendError, sendSuccess, sendNotFound, sendUnauthorized } from "../lib/response.js";
import {
  normalizeAttributes,
  mergeSizeAndAttributes,
  generateCartItemKey,
  areAttributesEqual,
  validateRequiredAttributes,
  objectToMap,
  mapToObject,
  findMatchingVariant,
  getProductPrice,
} from "../utils/cartUtils.js";

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

    const cart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      // Return all product fields including _id, discountPrice, variants, category, merchant, etc.
      // No select() means all fields are returned (better for frontend)
    }).populate({
      path: "products.product.category",
      select: "name",
    }).populate({
      path: "products.product.merchant",
      select: "businessName businessEmail",
    });

    if (!cart) {
      // Return empty cart structure instead of 404 for better UX
      return sendSuccess(res, {
        data: {
          products: [],
          totalQuantity: 0,
          totalPrice: 0,
        },
        message: "Cart is empty",
      });
    }

    return sendSuccess(res, {
      data: cart,
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
          quantity,
          size: mergedAttributes.size || '', // Keep legacy size for backward compatibility
          attributes: attributesMap,
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
        select: "businessName businessEmail",
      });
      return sendSuccess(res, {
        data: populatedCart,
        message: "Product added to cart successfully",
        statusCode: 201,
      });
    }

    // If cart exists, check if the product with the same attributes is already in it
    const productIndex = cart.products.findIndex((item) => {
      const isProductIdMatch = item.product.toString() === productId.toString();
      if (!isProductIdMatch) return false;

      // Get attributes from item (support both new Map format and legacy size)
      let itemAttributes = {};
      if (item.attributes && item.attributes instanceof Map) {
        itemAttributes = mapToObject(item.attributes);
      } else if (item.size) {
        // Legacy: convert size to attributes format
        itemAttributes = { size: item.size };
      }

      // Compare attributes
      return areAttributesEqual(itemAttributes, mergedAttributes);
    });

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

    let recalculatedTotalPrice = 0;
    for (const item of cart.products) {
      // Fetch product to get its current price (important if prices change)
      const p = await Product.findById(item.product);
      if (p) {
        // Get attributes from item to find variant price if applicable
        let itemAttributes = {};
        if (item.attributes && item.attributes instanceof Map) {
          itemAttributes = mapToObject(item.attributes);
        } else if (item.size) {
          itemAttributes = { size: item.size };
        }
        // Get correct price (variant or product price)
        const itemPrice = getProductPrice(p, itemAttributes);
        recalculatedTotalPrice += itemPrice * item.quantity;
      }
    }
    cart.totalPrice = recalculatedTotalPrice;

    // Save the updated cart
    await cart.save();

    // Populate the updated cart before sending the response
    const populatedCart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      // Return all product fields
    }).populate({
      path: "products.product.category",
      select: "name",
    }).populate({
      path: "products.product.merchant",
      select: "businessName businessEmail",
    });
    return sendSuccess(res, {
      data: populatedCart,
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

    const productIndex = cart.products.findIndex((item) => {
      const isProductIdMatch = item.product.toString() === productId.toString();
      if (!isProductIdMatch) return false;

      // Get attributes from item (support both new Map format and legacy size)
      let itemAttributes = {};
      if (item.attributes && item.attributes instanceof Map) {
        itemAttributes = mapToObject(item.attributes);
      } else if (item.size) {
        // Legacy: convert size to attributes format
        itemAttributes = { size: item.size };
      }

      // Compare attributes
      return areAttributesEqual(itemAttributes, mergedAttributes);
    });
    
    
    
    if (productIndex === -1) {
      return res
        .status(404)
        .json({ message: "Product not found in the cart." });
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
    let recalculatedTotalPrice = 0;
    for (const item of cart.products) {
      const p = await Product.findById(item.product);
      if (p) {
        // Get attributes from item to find variant price if applicable
        let itemAttributes = {};
        if (item.attributes && item.attributes instanceof Map) {
          itemAttributes = mapToObject(item.attributes);
        } else if (item.size) {
          itemAttributes = { size: item.size };
        }
        // Get correct price (variant or product price)
        const itemPrice = getProductPrice(p, itemAttributes);
        recalculatedTotalPrice += itemPrice * item.quantity;
      }
    }
    cart.totalPrice = recalculatedTotalPrice;
    await cart.save();
    const populatedCart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      // Return all product fields
    }).populate({
      path: "products.product.category",
      select: "name",
    }).populate({
      path: "products.product.merchant",
      select: "businessName businessEmail",
    });
    res.status(200).json(populatedCart);
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
    cart.products = cart.products.filter((item) => {
      const isProductIdMatch = item.product.toString() === productId.toString();
      if (!isProductIdMatch) return true; // Keep items with different product IDs

      // Get attributes from item (support both new Map format and legacy size)
      let itemAttributes = {};
      if (item.attributes && item.attributes instanceof Map) {
        itemAttributes = mapToObject(item.attributes);
      } else if (item.size) {
        // Legacy: convert size to attributes format
        itemAttributes = { size: item.size };
      }

      // Remove item if product ID and attributes match
      return !areAttributesEqual(itemAttributes, mergedAttributes);
    });

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

    let recalculatedTotalPrice = 0;
    for (const item of cart.products) {
      const p = await Product.findById(item.product);
      if (p) {
        // Get attributes from item to find variant price if applicable
        let itemAttributes = {};
        if (item.attributes && item.attributes instanceof Map) {
          itemAttributes = mapToObject(item.attributes);
        } else if (item.size) {
          itemAttributes = { size: item.size };
        }
        // Get correct price (variant or product price)
        const itemPrice = getProductPrice(p, itemAttributes);
        recalculatedTotalPrice += itemPrice * item.quantity;
      }
    }
    cart.totalPrice = recalculatedTotalPrice;

    await cart.save();

    const populatedCart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      // Return all product fields
    }).populate({
      path: "products.product.category",
      select: "name",
    }).populate({
      path: "products.product.merchant",
      select: "businessName businessEmail",
    });
    res.status(200).json(populatedCart);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Server error while removing item from cart.",
        error: error.message,
      });
  }
};
