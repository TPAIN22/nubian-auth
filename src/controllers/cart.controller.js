import Cart from "../models/carts.model.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";
import Product from "../models/product.model.js";

// GET USER'S CART
export const getCart = async (req, res) => {
  const { userId } = getAuth(req); // Get Clerk userId from authentication
  try {
    // Find the user in your database using their Clerk ID
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Find the cart for the user and populate product details
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
    console.error("Error fetching cart:", error);
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
  const { userId } = getAuth(req); // Get Clerk userId from authentication

  const { productId, quantity } = req.body;
  // 1. توحيد قيمة 'size' المستلمة من الطلب:
  //    تحويلها إلى String، إزالة المسافات البيضاء، وتحويل 'null' أو 'undefined' إلى سلسلة نصية فارغة.
  const sizeFromRequest = req.body.size;
  const normalizedSize = (sizeFromRequest === null || sizeFromRequest === undefined || String(sizeFromRequest).toLowerCase() === 'null' || String(sizeFromRequest).toLowerCase() === 'undefined' ? "" : String(sizeFromRequest)).trim();

  // Basic input validation
  if (!productId || !quantity) {
    return res
      .status(400)
      .json({ message: "Product ID and quantity are required." });
  }
  if (typeof quantity !== "number" || quantity <= 0) {
    return res
      .status(400)
      .json({ message: "Quantity must be a positive number." });
  }

  try {
    // Find the user in your database
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Check if the product exists and get its price
    const productExists = await Product.findById(productId);
    if (!productExists) {
      return res.status(404).json({ message: "Product not found." });
    }

    // Find the user's cart
    // **مهم:** لا تقم بعمل populate هنا. نحتاج إلى الـ ObjectId الخام للمقارنة.
    let cart = await Cart.findOne({ user: user._id });

    // If no cart exists, create a new one
    if (!cart) {
      console.log("No cart found for user. Creating new cart.");
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
    console.log("Existing cart found. Checking for product match.");
    console.log("Incoming productId:", productId.toString());
    console.log("Normalized incoming size:", `'${normalizedSize}'`); // عرض المقاس بين علامتي اقتباس لتوضيح أي مسافات

    const productIndex = cart.products.findIndex(
      (item) => {
        // 2. توحيد قيمة 'item.size' من قاعدة البيانات للمقارنة:
        const itemNormalizedSize = (item.size === null || item.size === undefined || String(item.size).toLowerCase() === 'null' || String(item.size).toLowerCase() === 'undefined' ? "" : String(item.size)).trim();

        const isProductIdMatch = item.product.toString() === productId.toString();
        const isSizeMatch = itemNormalizedSize === normalizedSize;

        console.log(`  Comparing item in cart (ID: ${item.product.toString()}, Size: '${itemNormalizedSize}')`);
        console.log(`  Matches incoming ID: ${isProductIdMatch}, Matches incoming Size: ${isSizeMatch}`);
        console.log(`  Overall match for this item: ${isProductIdMatch && isSizeMatch}`);

        return isProductIdMatch && isSizeMatch;
      }
    );


    if (productIndex > -1) {
      console.log(`Product found at index ${productIndex}. Incrementing quantity from ${cart.products[productIndex].quantity} to ${cart.products[productIndex].quantity + quantity}.`);
      // Product with the same ID and size exists, update its quantity
      cart.products[productIndex].quantity += quantity;
    } else {
      console.log("Product not found in cart with matching size. Adding as new item.");
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
    console.error("Error adding item to cart:", error);
    res
      .status(500)
      .json({
        message: "Server error while adding item to cart.",
        error: error.message,
      });
  }
};


export const updateCart = async (req, res) => {
  const { userId } = getAuth(req); // Get Clerk userId from authentication
  const { productId, quantity, size = "" } = req.body;

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
      (item) =>
        item.product.toString() === productId.toString() && item.size === size
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
    console.error("Error updating cart:", error);
    res
      .status(500)
      .json({
        message: "Server error while updating cart.",
        error: error.message,
      });
  }
};
export const removeFromCart = async (req, res) => {
  const { userId } = getAuth(req);
  const { productId, size = "" } = req.body; // نطلب productId و size فقط للحذف

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
      (item) =>
        !(
          item.product.toString() === productId.toString() && item.size === size
        )
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
    console.error("Error removing item from cart:", error);
    res
      .status(500)
      .json({
        message: "Server error while removing item from cart.",
        error: error.message,
      });
  }
};
