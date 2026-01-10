import mongoose from "mongoose";
const marketerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    code: {
        type: String,
        unique: true,
        required: true
    },
    commissionRate: {
        type: Number,
        default: 0.05 // 5%
    },
    discountRate: {
        type: Number,
        default: 0.1 // 10%
    },
    totalEarnings: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Indexes for frequently queried fields
// Note: code index is automatically created by unique: true, so we don't need to add it again
marketerSchema.index({ createdAt: -1 }); // For sorting by creation date

const Marketer = mongoose.model('Marketer', marketerSchema);

export default Marketer; 