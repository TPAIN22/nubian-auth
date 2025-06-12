import Cart from "../models/carts.model.js";
import { getAuth } from "@clerk/express";
import User from "../models/user.model.js";
import mongoose from "mongoose"; 


export const getCart = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    const user = await User.findOne({ clerkId: userId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const cart = await Cart.findOne({ user: user._id }).populate(
      "products.product"
    );

    if (!cart) {
      return res.status(404).json({ message: "No cart found for this user" });
    }

    res.status(200).json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log(error, "error in getCart");
  }
};


export const addToCart = async (req, res) => {
  const { userId } = getAuth(req);

  try {
    const { productId, quantity, size } = req.body;

    if (!productId) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid product ID format" });
    }

    const user = await User.findOne({ clerkId: userId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    
    const productExists = await mongoose.model("Product").findById(productId);

    if (!productExists) {
      return res.status(404).json({ message: "Product not found" });
    }

    let cart = await Cart.findOne({ user: user._id });
    if (!cart) {
      cart = new Cart({
        user: user._id,
        products: [{ product: productId, quantity, size }],
        totalQuantity: quantity,
        totalPrice: 0,
      });
    } else {
      const productIndex = cart.products.findIndex(
        (p) =>
          p.product && p.product.toString() === productId && p.size === size
      );

      if (productIndex !== -1) {
        cart.products[productIndex].quantity += quantity;
      } else {
        cart.products.push({ product: productId, quantity, size });
      }

      cart.totalQuantity = cart.products.reduce(
        (acc, item) => acc + item.quantity,
        0
      );
    }
    await cart.populate({
      path: "products.product",
      select: "price name image",
    });

    cart.totalPrice = cart.products.reduce((acc, item) => {
      if (item.product && item.product.price) {
        return acc + item.product.price * item.quantity;
      } else {
        console.warn(`Product missing or has no price: ${item.product?._id}`);
        return acc;
      }
    }, 0);
    await cart.save();
    res.status(200).json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log(error, "error in addToCart");
  }
};


export const updateCart = async (req, res) => {
  const { userId } = getAuth(req); 
  try {
    const user = await User.findOne({ clerkId: userId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { productId, quantity, size } = req.body; 

    
    const cart = await Cart.findOne({ user: user._id });

    if (!cart) {
      return res.status(404).json({ message: "No cart found for this user" });
    }

    
    let newProductsArray = [...cart.products];

    
    const productIndex = newProductsArray.findIndex((p) => {
      
      const isSameProduct = p.product.toString() === productId;
      
      const isSameSize = (size === null && (!p.size || p.size === '')) || (size === p.size);
      return isSameProduct && isSameSize;
    });

    if (productIndex !== -1) {
      
      if (quantity === 0) {
        
        newProductsArray.splice(productIndex, 1);
      } else {
        
        newProductsArray[productIndex].quantity = Math.max(
          1, 
          newProductsArray[productIndex].quantity + quantity 
        );
      }
    } else {
      
      
      
      return res.status(404).json({ message: "Product not found in cart for update" });
    }

    
    
    const updatedCart = await Cart.findOneAndUpdate(
      { _id: cart._id }, 
      { $set: { products: newProductsArray } }, 
      { new: true, runValidators: true } 
    ).populate("products.product"); 

    if (!updatedCart) {
      return res.status(404).json({ message: "Cart not found after update attempt" });
    }

    
    res.status(200).json(updatedCart);
  } catch (error) {
    
    if (error.name === 'VersionError') {
      return res.status(409).json({ message: "Cart was modified by another user/process. Please try again." });
    }
    
    res.status(500).json({ message: error.message });
    console.error(error, "error in updateCart"); 
  }
};



export const deleteCart = async (req, res) => {
  const { userId } = getAuth(req);
  try {
    
    const user = await User.findOne({ clerkId: userId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await Cart.findOneAndDelete({ user: user._id });
    res.status(200).json({ message: "Cart deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log(error, "error in deleteCart");
  }
};
