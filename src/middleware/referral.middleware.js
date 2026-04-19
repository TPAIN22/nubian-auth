/**
 * Middleware to extract referral code from various request sources
 */
export const extractReferral = (req, res, next) => {
  // Priority: 1. Query Param, 2. Custom Header, 3. Cookie, 4. Body
  const code = req.query.ref
    || req.headers['x-referral-code']
    || (req.cookies && req.cookies.referralCode)
    || (req.body && req.body.referralCode)
    || null;

  if (code) {
    req.referralCode = String(code).toUpperCase().trim();
  }
  
  // Also capture device ID and platform if present in headers or body
  req.referralContext = {
    deviceId: req.headers['x-device-id'] || (req.body && req.body.deviceId) || null,
    platform: req.headers['x-platform'] || (req.body && req.body.platform) || 'web',
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent']
  };

  next();
};
