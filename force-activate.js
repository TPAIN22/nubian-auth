import mongoose from "mongoose";
import dotenv from "dotenv";
import Currency from "./src/models/currency.model.js";

dotenv.config();

async function forceActivate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const result = await Currency.updateMany(
            { code: { $in: ['EGP', 'SAR'] } },
            { $set: { isActive: true, allowManualRate: false } }
        );
        console.log(`Force activated ${result.modifiedCount} currencies.`);
        
        // Also check what we have
        const allActive = await Currency.find({ isActive: true, code: { $ne: 'USD' } }).select('code').lean();
        console.log('Active non-USD currencies:', allActive.map(c => c.code));
        
        await mongoose.connection.close();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

forceActivate();
