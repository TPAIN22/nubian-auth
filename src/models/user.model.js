// models/user.model.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  clerkId: {
    type: String,
    required: true,
    unique: true,
  },
  fullName: {
    type: String,
    required: false,
  },
  phone: {
    type: String,
    required: false,
  },
  
  address: {
    type: String,
    required: false,
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  emailAddress: {
    type: String,
    required: false,
  }
} , {timestamps:true});

// Indexes for frequently queried fields
userSchema.index({ clerkId: 1 }, { unique: true }); // Already unique, but explicit index
userSchema.index({ emailAddress: 1 }); // For email lookups

const User = mongoose.model("User", userSchema);
export default User;
