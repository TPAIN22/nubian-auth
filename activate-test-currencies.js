import mongoose from "mongoose";
import dotenv from "dotenv";
import Currency from "./src/models/currency.model.js";

dotenv.config();

async function activate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const result = await Currency.updateMany(
            { code: { $in: ['EGP', 'SAR'] } },
            { $set: { isActive: true } }
        );
        console.log(`Activated ${result.modifiedCount} currencies.`);
        await mongoose.connection.close();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

activate();
