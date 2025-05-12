import mongoose from 'mongoose';

const cartSchema = new mongoose.Schema({
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
            default: 1,
            min: 1,
        },
    }],
    totalQuantity: {
        type: Number,
        default: 0,
    },
    totalPrice: {
        type: Number,
        default: 0,
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

cartSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    this.totalQuantity = this.products.reduce((acc, item) => acc + item.quantity, 0);
    this.totalPrice = this.products.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
    
    next();
});

const Cart = mongoose.model('Cart', cartSchema);
export default Cart;
