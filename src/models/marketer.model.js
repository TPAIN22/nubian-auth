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
const Marketer = mongoose.model('Marketer', marketerSchema);

export default Marketer; 