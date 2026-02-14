import mongoose from "mongoose";

const ticketMessageSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // To distinguish between user and support agent/admin
    senderRole: {
        type: String,
        enum: ['user', 'admin', 'support'],
        required: true,
        default: 'user'
    },
    message: {
      type: String,
      required: true,
    },
    attachments: [
      {
        type: String,
      },
    ],
    readBy: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ]
  },
  {
    timestamps: true,
  }
);

const TicketMessage = mongoose.model("TicketMessage", ticketMessageSchema);
export default TicketMessage;
