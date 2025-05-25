import express from 'express';
import User from '../models/user.model.js';
import { Webhook } from 'svix';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  console.error("❌ WEBHOOK_SECRET is missing in .env");
  process.exit(1);
}

// Helper function to extract user data from Clerk event
const extractUserData = (data) => ({
  clerkId: data.id,
  fullName: `${data.first_name || ''} ${data.last_name || ''}`.trim(),
  phone: data.phone_numbers?.[0]?.phone_number || '',
  emailAddress: data.email_addresses?.[0]?.email_address || '',
});

router.post('/clerk', express.raw({ type: '*/*' }), async (req, res) => {
  const payload = req.body;
  const headers = req.headers;

  // Verify webhook signature
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt;
  
  try {
    evt = wh.verify(payload, headers);
  } catch (err) {
    console.error("❌ Webhook verification failed:", err.message);
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  const { type, data } = evt;
  console.log(`📥 Received webhook event: ${type} for user ${data.id}`);

  try {
    switch (type) {
      case 'user.created':
        {
          const userData = extractUserData(data);
          const newUser = await User.create(userData);
          console.log(`✅ User created successfully: ${newUser.clerkId}`);
        }
        break;

      case 'user.updated':
        {
          const userData = extractUserData(data);
          const updatedUser = await User.findOneAndUpdate(
            { clerkId: data.id },
            userData,
            { new: true, runValidators: true }
          );
          
          if (updatedUser) {
            console.log(`✅ User updated successfully: ${updatedUser.clerkId}`);
          } else {
            console.warn(`⚠️ User not found for update: ${data.id}`);
          }
        }
        break;

      case 'user.deleted':
        {
          const deletedUser = await User.findOneAndDelete({ clerkId: data.id });
          
          if (deletedUser) {
            console.log(`✅ User deleted successfully: ${deletedUser.clerkId}`);
          } else {
            console.warn(`⚠️ User not found for deletion: ${data.id}`);
          }
        }
        break;

      default:
        console.log(`ℹ️ Unhandled webhook event type: ${type}`);
    }

    return res.status(200).json({ 
      success: true, 
      message: "Webhook processed successfully",
      eventType: type 
    });

  } catch (err) {
    console.error(`❌ Error handling webhook event ${type}:`, err);
    
    // Check if it's a database-related error
    if (err.name === 'ValidationError') {
      console.error("Validation error details:", err.errors);
      return res.status(400).json({ 
        error: "Invalid user data", 
        details: err.message 
      });
    }
    
    if (err.name === 'MongoError' || err.name === 'MongooseError') {
      console.error("Database error:", err.message);
      return res.status(503).json({ 
        error: "Database temporarily unavailable" 
      });
    }

    // Generic server error
    return res.status(500).json({ 
      error: "Internal server error" 
    });
  }
});

export default router;