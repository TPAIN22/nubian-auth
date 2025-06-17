import Product from '../models/product.model.js'
import User from '../models/user.model.js'
import { getAuth } from '@clerk/express'
export const getProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 8;
    const skip = (page - 1) * limit;

    const { category } = req.query; // <-- هنا

    console.log("Received query params:", req.query);
    console.log("category from query:", category);

    const filter = {};
    if (category) {
      console.log("Filtering by category:", category);
      filter.category = category;
    } else {
      console.log("No category filter applied.");
    }

    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    console.log(`Found ${products.length} products`);

    const totalProducts = await Product.countDocuments(filter);
    console.log("Total products count:", totalProducts);

    res.status(200).json({
      products,
      page,
      totalPages: Math.ceil(totalProducts / limit),
    });
  } catch (error) {
    console.error("Error in getProducts:", error.message);
    res.status(500).json({ message: error.message });
  }
};


export const getProductById = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
        res.status(200).json(product)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const createProduct = async (req, res) => {
    try {
        const product = await Product.create(req.body)
        res.status(201).json(product)
    } catch (error) {
        res.status(500).json({ message: error.message })
        console.log(error)
    }
}
export const updateProduct = async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
        res.status(200).json(product)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const deleteProduct = async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id)
        res.status(200).json({ message: 'Product deleted' })
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}  

