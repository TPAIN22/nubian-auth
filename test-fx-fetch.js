import mongoose from "mongoose";
import dotenv from "dotenv";
import { fetchLatestRates } from "./src/services/fx.service.js";

dotenv.config();

async function testFetch() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected.");

        console.log("Triggering FX fetch...");
        const result = await fetchLatestRates();
        console.log("Fetch Result:", JSON.stringify(result, null, 2));

        console.log("Closing connection...");
        await mongoose.connection.close();
        console.log("Done.");
    } catch (error) {
        console.error("Test failed:", error);
        process.exit(1);
    }
}

testFetch();
