import Review from '../models/reviews.model.js'

export const getReviews = async (req, res) => {
    try {
        const reviews = await Review.find()
        res.status(200).json(reviews)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const getReviewById = async (req, res) => {
    try {
        const review = await Review.findById(req.params.id)
        res.status(200).json(review)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const createReview = async (req, res) => {
    try {
        const review = await Review.create(req.body)
        res.status(201).json(review)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const updateReview = async (req, res) => {
    try {
        const review = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true })
        res.status(200).json(review)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const deleteReview = async (req, res) => {
    try {
        await Review.findByIdAndDelete(req.params.id)
        res.status(200).json({ message: 'Review deleted' })
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
