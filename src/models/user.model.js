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
// Note: clerkId index is automatically created by unique: true, so we don't need to add it again
userSchema.index({ emailAddress: 1 }); // For email lookups

const User = mongoose.model("User", userSchema);
export default User;
