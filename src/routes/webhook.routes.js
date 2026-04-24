import express from 'express';
import User from '../models/user.model.js';
import { Webhook } from 'svix';
import logger from '../lib/logger.js';

const router = express.Router();

// envValidator.js already guarantees CLERK_WEBHOOK_SECRET is present at startup.
const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

// Helper function to extract user data from Clerk event
const extractUserData = (data) => {
  const firstName = data.first_name || '';
  const lastName = data.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim() || 
                   data.username || 
                   data.email_addresses?.[0]?.email_address?.split('@')[0] || 
                   'User';
  
  return {
    clerkId: data.id,
    fullName: fullName,
    phone: data.phone_numbers?.[0]?.phone_number || '',
    emailAddress: data.email_addresses?.[0]?.email_address || '',
  };
};

router.post('/clerk', express.raw({ type: '*/*' }), async (req, res) => {
  const payload = req.body;
  const headers = req.headers;

  logger.info('Clerk webhook received', {
    eventId: headers['svix-id'],
    eventType: headers['svix-timestamp'],
  });

  // Verify webhook signature
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt;
  
  try {
    evt = wh.verify(payload, headers);
    logger.info('Webhook signature verified', {
      eventType: evt.type,
      userId: evt.data?.id,
    });
  } catch (err) {
    logger.error('Invalid webhook signature', {
      error: err.message,
      headers: {
        'svix-id': headers['svix-id'],
        'svix-timestamp': headers['svix-timestamp'],
        'svix-signature': headers['svix-signature'] ? 'present' : 'missing',
      },
    });
    return res.status(400).json({ 
      success: false,
      error: "Invalid webhook signature" 
    });
  }

  const { type, data } = evt;

  try {
    switch (type) {
      case 'user.created':
        {
          // findOneAndUpdate with upsert is atomic — handles retries and race conditions
          // without a separate findOne pre-check.
          const clerkId = data.id;
          logger.info('Processing user.created event', { clerkId });

          const newUser = await User.findOneAndUpdate(
            { clerkId },
            extractUserData(data),
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
          );

          logger.info('User created/confirmed via webhook', { clerkId, userId: newUser._id });
        }
        break;

      case 'user.updated':
        {
          const clerkId = data.id;
          logger.info('Processing user.updated event', { clerkId });

          const userData = extractUserData(data);
          const updatedUser = await User.findOneAndUpdate(
            { clerkId: clerkId },
            userData,
            { 
              new: true, 
              runValidators: true,
              upsert: true, // Create if doesn't exist (handles missed user.created events)
              setDefaultsOnInsert: true,
            }
          );
          
          if (updatedUser) {
            logger.info('User updated successfully via webhook', {
              clerkId,
              userId: updatedUser._id,
              emailAddress: updatedUser.emailAddress,
            });
          } else {
            logger.warn('User update: User not found and was not created (unexpected)', {
              clerkId,
            });
          }
        }
        break;

      case 'user.deleted':
        {
          // Soft-delete: anonymise PII but keep the document so that all
          // Orders, Tickets, Reviews, and Addresses referencing this user._id
          // remain intact. Hard-deleting leaves dangling ObjectIds everywhere.
          const clerkId = data.id;
          logger.info('Processing user.deleted event', { clerkId });

          const deletedUser = await User.findOneAndUpdate(
            { clerkId },
            {
              isDeleted: true,
              deletedAt: new Date(),
              fullName: 'Deleted User',
              emailAddress: '',
              phone: '',
            },
            { new: true }
          );

          if (deletedUser) {
            logger.info('User soft-deleted via webhook', {
              clerkId,
              userId: deletedUser._id,
            });
          } else {
            logger.warn('User deletion: user not found in database', { clerkId });
          }
        }
        break;

      default:
        logger.info('Unhandled webhook event type', { eventType: type });
    }

    return res.status(200).json({ 
      success: true, 
      message: "Webhook processed successfully",
      eventType: type 
    });

  } catch (err) {
    logger.error('Error processing Clerk webhook', {
      eventType: type,
      userId: data?.id,
      error: err.message,
      errorName: err.name,
      errorCode: err.code,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
    
    // Handle MongoDB duplicate key error (code 11000)
    if (err.name === 'MongoServerError' && err.code === 11000) {
      logger.warn('Duplicate key error in webhook - user may have been created in race condition', {
        eventType: type,
        userId: data?.id,
        duplicateField: Object.keys(err.keyPattern || {}),
      });
      
      // If it's a duplicate clerkId, try to fetch the existing user
      if (type === 'user.created' && err.keyPattern?.clerkId) {
        try {
          const existingUser = await User.findOne({ clerkId: data.id });
          if (existingUser) {
            logger.info('Recovered from duplicate key error - user already exists', {
              clerkId: data.id,
              userId: existingUser._id,
            });
            return res.status(200).json({ 
              success: true, 
              message: "User already exists (duplicate key handled)",
              eventType: type,
              userId: existingUser._id.toString(),
            });
          }
        } catch (fetchError) {
          logger.error('Failed to recover from duplicate key error', {
            error: fetchError.message,
          });
        }
      }
      
      return res.status(409).json({ 
        success: false,
        error: "Duplicate entry - user may already exist",
        code: "DUPLICATE_ENTRY",
        eventType: type,
      });
    }
    
    // Check if it's a validation error
    if (err.name === 'ValidationError') {
      logger.error('Validation error in webhook', {
        eventType: type,
        userId: data?.id,
        validationErrors: err.errors,
      });
      return res.status(400).json({ 
        success: false,
        error: "Invalid user data", 
        details: err.message,
        eventType: type,
      });
    }
    
    // Handle other MongoDB errors
    if (err.name === 'MongoError' || err.name === 'MongooseError' || err.name === 'MongoServerError') {
      logger.error('MongoDB error in webhook', {
        eventType: type,
        userId: data?.id,
        errorCode: err.code,
        errorName: err.name,
      });
      return res.status(503).json({ 
        success: false,
        error: "Database temporarily unavailable",
        eventType: type,
      });
    }

    // Generic server error
    logger.error('Unexpected error in webhook handler', {
      eventType: type,
      userId: data?.id,
      error: err.message,
      errorName: err.name,
    });
    return res.status(500).json({ 
      success: false,
      error: "Internal server error",
      eventType: type,
    });
  }
});

export default router;