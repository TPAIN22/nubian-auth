import { requireAuth, clerkClient } from '@clerk/express';

export const isAuthenticated = requireAuth(); // يحمي الراوت

export const isAdmin = async (req, res, next) => {
  try {
    const userId = req.auth.userId; // لاحظ هنا req.auth
    const user = await clerkClient.users.getUser(userId);

    if (user.publicMetadata.role !== 'admin') {
      return res.status(403).json({ message: 'Admins only' });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
