import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null, // الفئات الرئيسية لن يكون لها أب
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        required: false,
        trim: true,
    },
    image: {
        type: String,
        required: false,
    },
    isActive: { 
        type: Boolean,
        default: true,
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

categorySchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Indexes for frequently queried fields
categorySchema.index({ parent: 1 }); // For hierarchical category queries
categorySchema.index({ isActive: 1 }); // For filtering active categories

const Category = mongoose.model('Category', categorySchema);

export default Category;
