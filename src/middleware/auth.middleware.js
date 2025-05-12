import { requireAuth, clerkClient } from '@clerk/express';

// التوثيق
export const isAuthenticated = requireAuth();

// التحقق من أن المستخدم هو مسؤول
export const isAdmin = async (req, res, next) => {
  try {
    const userId = req.user.id;  // استخدم req.user.id هنا بدلاً من req.auth.userId
    const user = await clerkClient.users.getUser(userId);

    if (user.publicMetadata.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized: Admins only' });
    }
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).json({ message: 'Server error during admin check' });
  }
};
