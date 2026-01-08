import Cart from "../models/carts.model.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";
import Product from "../models/product.model.js";
import logger from "../lib/logger.js";

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
    return res.status(401).json({ message: "Authentication required." });
  }
  
  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      logger.warn('Get cart failed: User not found in database', {
        requestId: req.requestId,
        userId,
        clerkId: userId,
      });
      return res.status(404).json({ message: "User not found." });
    }

    const cart = await Cart.findOne({ user: user._id }).populate({
    path:"products.product",
    select:"name price images"
    }
    );

    if (!cart) {
      return res.status(404).json({ message: "Cart not found for this user." });
    }

    res.status(200).json(cart);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Server error while fetching cart.",
        error: error.message,
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
      return res.status(401).json({ message: "Authentication required." });
    }

    const { productId, quantity } = req.body;
    // 1. توحيد قيمة 'size' المستلمة من الطلب:
    //    تحويلها إلى String، إزالة المسافات البيضاء، وتحويل 'null' أو 'undefined' إلى سلسلة نصية فارغة.
    const sizeFromRequest = req.body.size;
    const normalizedSize = (sizeFromRequest === null || sizeFromRequest === undefined || String(sizeFromRequest).toLowerCase() === 'null' || String(sizeFromRequest).toLowerCase() === 'undefined' ? "" : String(sizeFromRequest)).trim();

    // Basic input validation
    if (!productId || !quantity) {
      logger.warn('Add to cart failed: Missing required fields', {
        requestId: req.requestId,
        userId,
        hasProductId: !!productId,
        hasQuantity: !!quantity,
      });
      return res
        .status(400)
        .json({ message: "Product ID and quantity are required." });
    }
    if (typeof quantity !== "number" || quantity <= 0) {
      logger.warn('Add to cart failed: Invalid quantity', {
        requestId: req.requestId,
        userId,
        productId,
        quantity,
        quantityType: typeof quantity,
      });
      return res
        .status(400)
        .json({ message: "Quantity must be a positive number." });
    }

    // Find the user in your database
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      logger.warn('Add to cart failed: User not found in database', {
        requestId: req.requestId,
        userId,
        clerkId: userId,
      });
      return res.status(404).json({ message: "User not found." });
    }

    // Check if the product exists and get its price
    const productExists = await Product.findById(productId);
    if (!productExists) {
      logger.warn('Add to cart failed: Product not found', {
        requestId: req.requestId,
        userId,
        productId,
      });
      return res.status(404).json({ message: "Product not found." });
    }

    // Find the user's cart
    // **مهم:** لا تقم بعمل populate هنا. نحتاج إلى الـ ObjectId الخام للمقارنة.
    let cart = await Cart.findOne({ user: user._id });

    // If no cart exists, create a new one
    if (!cart) {
      const newCart = new Cart({
        user: user._id,
        products: [{ product: productId, quantity, size: normalizedSize }], // استخدم normalizedSize هنا
        totalQuantity: quantity,
        totalPrice: productExists.price * quantity,
      });
      await newCart.save();

      // Populate the newly created cart before sending it back
      const populatedCart = await Cart.findById(newCart._id).populate({
        path: "products.product",
        select: "name price images description stock sizes", // تأكد من تحديد كل الحقول التي تحتاجها هنا
      });
      return res.status(201).json(populatedCart);
    }

    // If cart exists, check if the product (with the specific size) is already in it

    const productIndex = cart.products.findIndex(
      (item) => {
        // 2. توحيد قيمة 'item.size' من قاعدة البيانات للمقارنة:
        const itemNormalizedSize = (item.size === null || item.size === undefined || String(item.size).toLowerCase() === 'null' || String(item.size).toLowerCase() === 'undefined' ? "" : String(item.size)).trim();

        const isProductIdMatch = item.product.toString() === productId.toString();
        const isSizeMatch = itemNormalizedSize === normalizedSize;


        return isProductIdMatch && isSizeMatch;
      }
    );


    if (productIndex > -1) {
      // Product with the same ID and size exists, update its quantity
      cart.products[productIndex].quantity += quantity;
    } else {
      // Product not found or has a different size, add it as a new item
      cart.products.push({ product: productId, quantity, size: normalizedSize }); // استخدم normalizedSize هنا
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
        // Ensure product still exists
        recalculatedTotalPrice += p.price * item.quantity;
      }
    }
    cart.totalPrice = recalculatedTotalPrice;

    // Save the updated cart
    await cart.save();

    // Populate the updated cart before sending the response
    const populatedCart = await Cart.findOne({ user: user._id }).populate({
      path: "products.product",
      select: "name price images description stock sizes", // تأكد من تحديد كل الحقول التي تحتاجها هنا
    });
    res.status(200).json(populatedCart);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Server error while adding item to cart.",
        error: error.message,
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
  
  const { productId, quantity } = req.body;
  
  // توحيد قيمة 'size' المستلمة من الطلب
  const sizeFromRequest = req.body.size;
  const normalizedSize = (sizeFromRequest === null || sizeFromRequest === undefined || String(sizeFromRequest).toLowerCase() === 'null' || String(sizeFromRequest).toLowerCase() === 'undefined' ? "" : String(sizeFromRequest)).trim();


  if (!productId || !quantity) {
    return res
      .status(400)
      .json({ message: "Product ID and quantity are required." });
  }
  if (typeof quantity !== "number" || quantity === 0) {
    return res.status(400).json({ message: "Quantity change must provided." });
  }

  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    const cart = await Cart.findOne({ user: user._id });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found for this user." });
    }

    const productIndex = cart.products.findIndex(
      (item) => {
        // توحيد قيمة 'item.size' من قاعدة البيانات للمقارنة
        const itemNormalizedSize = (item.size === null || item.size === undefined || String(item.size).toLowerCase() === 'null' || String(item.size).toLowerCase() === 'undefined' ? "" : String(item.size)).trim();

        const isProductIdMatch = item.product.toString() === productId.toString();
        const isSizeMatch = itemNormalizedSize === normalizedSize;
        return isProductIdMatch && isSizeMatch;
      }
    );
    
    
    
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
        recalculatedTotalPrice += p.price * item.quantity;
      }
    }
    cart.totalPrice = recalculatedTotalPrice;
    await cart.save();
    const populatedCart = await Cart.findOne({ user: user._id }).populate(
      {
        path:"products.product",
        select:"name price images"
      }
    );
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
  
  const { productId } = req.body;
  
  // توحيد قيمة 'size' المستلمة من الطلب
  const sizeFromRequest = req.body.size;
  const normalizedSize = (sizeFromRequest === null || sizeFromRequest === undefined || String(sizeFromRequest).toLowerCase() === 'null' || String(sizeFromRequest).toLowerCase() === 'undefined' ? "" : String(sizeFromRequest)).trim();

  if (!productId) {
    return res
      .status(400)
      .json({ message: "Product ID is required to remove from cart." });
  }

  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const cart = await Cart.findOne({ user: user._id });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found for this user." });
    }

    const initialLength = cart.products.length;
    cart.products = cart.products.filter(
      (item) => {
        // توحيد قيمة 'item.size' من قاعدة البيانات للمقارنة
        const itemNormalizedSize = (item.size === null || item.size === undefined || String(item.size).toLowerCase() === 'null' || String(item.size).toLowerCase() === 'undefined' ? "" : String(item.size)).trim();

        const isProductIdMatch = item.product.toString() === productId.toString();
        const isSizeMatch = itemNormalizedSize === normalizedSize;

        // نعيد false إذا كان المنتج والحجم متطابقان (لنحذفه)
        return !(isProductIdMatch && isSizeMatch);
      }
    );

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
        recalculatedTotalPrice += p.price * item.quantity;
      }
    }
    cart.totalPrice = recalculatedTotalPrice;

    await cart.save();

    const populatedCart = await Cart.findOne({ user: user._id }).populate(
      {
        path:"products.product",
        select:"name price images"
      }
    );
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
