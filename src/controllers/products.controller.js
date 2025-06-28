import Product from '../models/product.model.js'
export const getProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 8;
    const skip = (page - 1) * limit;

    const { category } = req.query;

    console.log('getProducts called with:', { page, limit, skip, category });

    const filter = {};
    if (category) {
      filter.category = category;
    } else {
    }

    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalProducts = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / limit);

    console.log('getProducts result:', {
      productsCount: products.length,
      totalProducts,
      totalPages,
      currentPage: page
    });

    res.status(200).json({
      products,
      page,
      totalPages,
    });
  } catch (error) {
    console.error('getProducts error:', error);
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

