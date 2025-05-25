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
    discountPrice: {
      type: Number,
      default: 0,
      required: false,  
    },
    sizes: {
       type: [String],
       required: false,  
       enum: ['S', 'M', 'L', 'XL', 'XXL' , 'xxxl'],
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