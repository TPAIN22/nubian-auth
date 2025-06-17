import mongoose from 'mongoose'

export const connect = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI)
    } catch (error) {
        throw new Error("Failed to connect to database");
        
    }
} 