import mongoose from 'mongoose';

const notifySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    userId: { type: String, default: null },
    deviceId: { type: String, default: null },
    read: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('Notify', notifySchema);
