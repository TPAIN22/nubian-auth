import mongoose from "mongoose";

const commissionSchema = new mongoose.Schema({
  marketer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Marketer',
    required: true,
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true, // One commission per order
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Commission amount cannot be negative'],
  },
  rate: {
    type: Number,
    required: true, // Snapshot of rate at time of order
  },
  orderAmount: {
    type: Number,
    required: true, // Snapshot of order finalAmount
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'paid', 'rejected'],
    default: 'pending',
  },
  paidAt: {
    type: Date,
    default: null,
  },
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  notes: {
    type: String,
    default: null,
    trim: true,
  },
}, { timestamps: true });

// Indexes for common queries
commissionSchema.index({ marketer: 1, status: 1 });
commissionSchema.index({ marketer: 1, createdAt: -1 });
commissionSchema.index({ status: 1, createdAt: -1 });

// Guard against commissions being created for non-delivered or unpaid orders
commissionSchema.pre('save', async function (next) {
  if (!this.isNew) return next();
  const Order = mongoose.model('Order');
  const order = await Order.findById(this.order).select('status paymentStatus').lean();
  if (!order || order.status !== 'delivered' || order.paymentStatus !== 'paid') {
    return next(new Error('Commission can only be created for delivered and paid orders'));
  }
  next();
});

const Commission = mongoose.model('Commission', commissionSchema);

export default Commission;
