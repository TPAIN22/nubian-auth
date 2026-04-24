import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
    parent:      { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    name:        { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    image:       { type: String },
    isActive:    { type: Boolean, default: true },
}, { timestamps: true }); // removes manual createdAt/updatedAt + stale pre-save hook

// Indexes for frequently queried fields
categorySchema.index({ parent: 1 }); // For hierarchical category queries
categorySchema.index({ isActive: 1 }); // For filtering active categories
categorySchema.index({ name: 1 }); // For category name lookups

// Compound indexes for common query patterns
categorySchema.index({ parent: 1, isActive: 1 }); // Active subcategories of a parent
categorySchema.index({ isActive: 1, createdAt: -1 }); // Active categories sorted by creation date

const Category = mongoose.model('Category', categorySchema);

export default Category;
