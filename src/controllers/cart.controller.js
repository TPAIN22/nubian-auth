import User from '../models/user.model.js'
import { getAuth } from "@clerk/express";
import Cart from "../models/carts.model.js";
import Product from "../models/product.model.js";

export const getCart = async (req, res) => {
    const { userId } = getAuth(req);

    try {
        const user = await User.findOne({ clerkId: userId })
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const cart = await Cart.findOne({ user: user._id }).populate({
            path: "products.product",
            select: "name price image",
            model: 'Product'
        });

        if (!cart) {
            return res.status(200).json({ products: [], totalQuantity: 0, totalPrice: 0 });
        }

        res.status(200).json(cart);
    } catch (error) {
        console.error("Error in getCart:", error); 
        res.status(500).json({
            message: "An error occurred while fetching cart.",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};



export const updateCart = async (req, res) => {
  const { userId } = getAuth(req);

  const { productId, quantity, size = '' } = req.body; 

  if (!productId || quantity === undefined) {
    return res.status(400).json({ message: "Product ID and quantity are required." });
  }

  try {
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    let cart = await Cart.findOne({ user: user._id });

    if (!cart) {
      if (quantity <= 0) {
        return res.status(200).json({ message: "Cart is empty, no items to remove." });
      }

      cart = new Cart({
        user: user._id,
        products: [],
        totalQuantity: 0,
        totalPrice: 0,
      });
    }

    const existingProductIndex = cart.products.findIndex(
      (item) => item.product.toString() === productId && item.size === size
    );

    if (quantity <= 0) {
      if (existingProductIndex > -1) {
        cart.products.splice(existingProductIndex, 1);
      } else {
        return res.status(404).json({ message: "Product not found in cart to remove." });
      }
    } else {
      const productDetails = await Product.findById(productId);
      if (!productDetails) {
        return res.status(404).json({ message: "Product details not found." });
      }

      if (existingProductIndex > -1) {
        cart.products[existingProductIndex].quantity = quantity;
      } else {
        cart.products.push({
          product: productId,
          quantity: quantity,
          size: size,
        });
      }
    }
    cart.totalQuantity = cart.products.reduce((acc, item) => acc + item.quantity, 0);
    await cart.populate({
      path: 'products.product',
      select: 'price' 
    });

    cart.totalPrice = cart.products.reduce((acc, item) => {
      return acc + (item.quantity * (item.product ? item.product.price : 0));
    }, 0);
    cart.updatedAt = Date.now();
    await cart.save();
    res.status(200).json({
      message: "Cart updated successfully!",
      cart,
    });
  } catch (error) {
    console.error("Error in updateCart:", error);
    res.status(500).json({
      message: "An error occurred while updating the cart.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";
import User from "../models/user.model.js"; // Assuming you have a User model that links to Clerk IDs
import { getAuth } from "@clerk/nextjs/server"; // Adjust import path if needed for your setup

/**
 * @desc    Add a product to the user's cart or update its quantity if it already exists
 * @route   POST /api/cart/add
 * @access  Private (Clerk authentication)
 * @body    { productId: string, quantity: number, size?: string }
 */
export const addToCart = async (req, res) => {
  const { userId } = getAuth(req); // Get Clerk user ID

  const { productId, quantity, size = '' } = req.body; // Default size to empty string

  if (!productId || quantity === undefined || quantity < 1) {
    return res.status(400).json({ message: "Product ID and quantity (must be at least 1) are required." });
  }

  try {
    // 1. Find the Mongoose User document linked to the Clerk ID
    const user = await User.findOne({ clerkId: userId });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // 2. Find the product details to get its price
    const productDetails = await Product.findById(productId);
    if (!productDetails) {
      return res.status(404).json({ message: "Product details not found." });
    }

    // 3. Find the user's cart
    let cart = await Cart.findOne({ user: user._id });

    if (!cart) {
      // If no cart exists for the user, create a new one
      const newCart = new Cart({
        user: user._id,
        products: [],
        totalQuantity: 0,
        totalPrice: 0,
      });

      newCart.products.push({
        product: productId,
        quantity: quantity,
        size: size,
      });

      newCart.totalQuantity = newCart.products.reduce((acc, item) => acc + item.quantity, 0);
      
      await newCart.populate({
        path: 'products.product',
        select: 'price' 
      });
      newCart.totalPrice = newCart.products.reduce((acc, item) => {
        return acc + (item.quantity * (item.product ? item.product.price : 0));
      }, 0);
      
      await newCart.save(); // Don't forget to save the new cart!
      
      return res.status(201).json({
        message: "New cart created and product added successfully!",
        cart: newCart,
      });

    } else {
      // If a cart already exists, check if the product is already in it
      const existingProductIndex = cart.products.findIndex(
        (item) => item.product.toString() === productId && item.size === size
      );

      if (existingProductIndex > -1) {
        // If the product (with the same size) already exists, update its quantity
        cart.products[existingProductIndex].quantity += quantity;
      } else {
        // If the product doesn't exist, add it to the cart
        cart.products.push({
          product: productId,
          quantity: quantity,
          size: size,
        });
      }

      // Recalculate total quantity and total price for the existing cart
      cart.totalQuantity = cart.products.reduce((acc, item) => acc + item.quantity, 0);
      
      // Populate to ensure price is available for totalPrice calculation
      await cart.populate({
        path: 'products.product',
        select: 'price' 
      });
      cart.totalPrice = cart.products.reduce((acc, item) => {
        return acc + (item.quantity * (item.product ? item.product.price : 0));
      }, 0);

      cart.updatedAt = Date.now(); // Update the updatedAt timestamp
      await cart.save();

      return res.status(200).json({
        message: "Product added/updated in cart successfully!",
        cart,
      });
    }

  } catch (error) {
    console.error("Error in addToCart:", error);
    res.status(500).json({
      message: "An error occurred while adding product to cart.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};