import { getAuth } from '@clerk/express';
import User from '../models/user.model.js';
import logger from '../lib/logger.js';

export const requireUser = async (req, res, next) => {
  try {
    const { userId } = getAuth(req) || {};

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await User.findOne({ clerkId: userId });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    req.appUser = user;
    return next();
  } catch (error) {
    logger.error('requireUser middleware failed', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

export default requireUser;
