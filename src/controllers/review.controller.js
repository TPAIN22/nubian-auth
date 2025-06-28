import Review from '../models/reviews.model.js'
import Product from '../models/product.model.js'
import User from '../models/user.model.js'
import { getAuth } from '@clerk/express'

export const getReviews = async (req, res) => {
    try {
        const { product } = req.query;
        let query = {};
        
        console.log('getReviews called with query:', req.query);
        
        // إذا تم تمرير product في query parameters، قم بفلترة الريفيوهات حسب المنتج
        if (product) {
            // التحقق من أن product ID صحيح
            if (!product.match(/^[0-9a-fA-F]{24}$/)) {
                console.log('Invalid product ID format:', product);
                return res.status(400).json({ message: 'Invalid product ID format' });
            }
            query.product = product;
            console.log('Filtering reviews for product:', product);
        } else {
            console.log('No product filter applied, returning all reviews');
        }
        
        console.log('Final query:', query);
        
        const reviews = await Review.find(query).populate('user', 'name');
        console.log(`Found ${reviews.length} reviews for product: ${product || 'all products'}`);
        
        // طباعة تفاصيل الريفيوهات للـ debugging
        reviews.forEach((review, index) => {
            console.log(`Review ${index + 1}:`, {
                id: review._id,
                product: review.product,
                user: review.user?.name,
                rating: review.rating,
                comment: review.comment?.substring(0, 50) + '...'
            });
        });
        
        res.status(200).json(reviews)
    } catch (error) {
        console.error('Error in getReviews:', error);
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
        console.log('Review Body:', req.body);
        console.log('Review Headers:', req.headers);
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
        console.log('getAllReviews called');
        const reviews = await Review.find().populate('user', 'name').populate('product', 'name');
        console.log(`Total reviews in database: ${reviews.length}`);
        
        // طباعة تفاصيل جميع الريفيوهات
        reviews.forEach((review, index) => {
            console.log(`Review ${index + 1}:`, {
                id: review._id,
                productId: review.product?._id,
                productName: review.product?.name,
                user: review.user?.name,
                rating: review.rating,
                comment: review.comment?.substring(0, 50) + '...'
            });
        });
        
        res.status(200).json(reviews)
    } catch (error) {
        console.error('Error in getAllReviews:', error);
        res.status(500).json({ message: error.message })
    }
}
