import { requireAuth, clerkClient } from '@clerk/express';

export const isAuthenticated = requireAuth(); // يحمي الراوت

export const isAdmin = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const user = await clerkClient.users.getUser(userId);


    if (user.publicMetadata.role !== 'admin') {
      console.log("unotherized")
      return res.status(403).json({ message: 'Admins only' });
      
    }

    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};
