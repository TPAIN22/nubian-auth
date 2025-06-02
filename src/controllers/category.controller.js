import Category from '../models/categories.model.js'
export const getCategories = async (req, res) => {
    try {
        const categories = await Category.find().sort({ createdAt: -1 })
        res.status(200).json(categories)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const getCategoryById = async (req, res) => {
    try {
        const category = await Category.findById(req.params.id)
        res.status(200).json(category)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const createCategory = async (req, res) => {
    try {
        const category = await Category.create(req.body)
        res.status(201).json(category)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const updateCategory = async (req, res) => {
    try {
        const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true })
        res.status(200).json(category)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const deleteCategory = async (req, res) => {
    try {
        await Category.findByIdAndDelete(req.params.id)
        res.status(200).json({ message: 'Category deleted' })
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
