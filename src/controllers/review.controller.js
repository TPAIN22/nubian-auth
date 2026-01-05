import Review from '../models/reviews.model.js'
import Product from '../models/product.model.js'
import User from '../models/user.model.js'
import { getAuth } from '@clerk/express'
import logger from '../lib/logger.js'

export const getReviews = async (req, res) => {
    try {
        const { product } = req.query;
        let query = {};
        
        
        // إذا تم تمرير product في query parameters، قم بفلترة الريفيوهات حسب المنتج
        if (product) {
            // التحقق من أن product ID صحيح
            if (!product.match(/^[0-9a-fA-F]{24}$/)) {
                
                return res.status(400).json({ message: 'Invalid product ID format' });
            }
            query.product = product;
            
        } else {
            
        }
        
        
        
        const reviews = await Review.find(query).populate('user', 'name');
        
        
        // طباعة تفاصيل الريفيوهات للـ debugging
        reviews.forEach((review, index) => {
            
        });
        
        res.status(200).json(reviews)
    } catch (error) {
        logger.error('Error in getReviews', {
            requestId: req.requestId,
            error: error.message,
            stack: error.stack,
        });
        res.status(500).json({ message: 'Internal server error' })
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
        
        const { userId } = getAuth(req);
        const user = await User.findOne({ clerkId: userId });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        const review = await Review.create({
            user: user._id,
            product: req.body.product,
            rating: req.body.rating,
            comment: req.body.comment,
        });
        const product = await Product.findById(review.product)
        if (product) {
            product.reviews.push(review._id)
            const allReviews = await Review.find({ product: product._id })
            const avgRating = allReviews.reduce((acc, r) => acc + r.rating, 0) / allReviews.length
            product.averageRating = avgRating
            await product.save()
        }
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

export const getAllReviews = async (req, res) => {
    try {
        
        const reviews = await Review.find().populate('user', 'name').populate('product', 'name');
        
        
        // طباعة تفاصيل جميع الريفيوهات
        reviews.forEach((review, index) => {
            
        });
        
        res.status(200).json(reviews)
    } catch (error) {
        logger.error('Error in getAllReviews', {
            requestId: req.requestId,
            error: error.message,
            stack: error.stack,
        });
        res.status(500).json({ message: 'Internal server error' })
    }
}
