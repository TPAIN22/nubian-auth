import mongoose from 'mongoose';

const pushTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    platform: { type: String },
    deviceId: { type: String },
    userId: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('PushToken', pushTokenSchema);
