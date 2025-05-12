import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        required: true,
        trim: true,
    },
    price: {
        type: Number,
        required: true,
        min: [0.01, 'Price must be greater than 0'],
    },
    stock: {
        type: Number,
        required: true,
        min: [0, 'Stock cannot be negative'],
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    images: {
        type: [String],
        required: true,
        validate: {
            validator: (value) => value.length > 0, 
            message: 'At least one image is required',
        },
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true,
    },
    brand: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Brand',
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

productSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Product = mongoose.model('Product', productSchema);

export default Product;