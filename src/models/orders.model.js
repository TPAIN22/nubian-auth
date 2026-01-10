import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    products: [{
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true,
        },
        quantity: {
            type: Number,
            required: true,
            default: 1
        }
    }],
    totalAmount: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'],
        default: 'pending',
    },
    orderDate: {
        type: Date,
        default: Date.now,
    },
    phoneNumber: {
        type: String,
        required: true,
    },
    address: {
        type: String,
        required: true,
    },
    city: {
        type: String,
        required: true,
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'card'],
        required: true,
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed'],
        default: 'pending',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
    orderNumber: {
        type: String,
        unique: true,
    },
    coupon: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Coupon',
        default: null
    },
    discountAmount: {
        type: Number,
        default: 0
    },
    finalAmount: {
        type: Number,
        default: 0
    },

    // ⬇⬇⬇ الحقول الجديدة
    marketer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Marketer',
        default: null
    },
    marketerCommission: {
        type: Number,
        default: 0
    },
    // Merchant tracking - array of merchants whose products are in this order
    merchants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Merchant',
    }],
    // Merchant revenue breakdown - how much each merchant earned from this order
    merchantRevenue: [{
        merchant: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Merchant',
        },
        amount: {
            type: Number,
            default: 0,
        },
    }],
});

orderSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

// Indexes for frequently queried fields
orderSchema.index({ user: 1 }); // Frequently queried for user orders
// Note: orderNumber index is automatically created by unique: true, so we don't need to add it again
// Note: status is not indexed here since we use compound indexes that include status
orderSchema.index({ merchants: 1 }); // For filtering by merchant
orderSchema.index({ orderDate: -1 }); // For sorting by newest orders
orderSchema.index({ createdAt: -1 }); // For sorting by creation date
orderSchema.index({ paymentStatus: 1 }); // For filtering by payment status

// Compound indexes for common query patterns
orderSchema.index({ user: 1, status: 1 }); // User orders by status (e.g., get user's pending orders)
orderSchema.index({ user: 1, orderDate: -1 }); // User orders sorted by date
orderSchema.index({ merchants: 1, status: 1 }); // Merchant orders by status (e.g., merchant's pending orders)
orderSchema.index({ merchants: 1, orderDate: -1 }); // Merchant orders sorted by date
orderSchema.index({ status: 1, paymentStatus: 1 }); // Orders by status and payment status
orderSchema.index({ status: 1, orderDate: -1 }); // Orders by status sorted by date
orderSchema.index({ marketer: 1, status: 1 }); // Marketer orders by status

const Order = mongoose.model('Order', orderSchema);

export default Order;
