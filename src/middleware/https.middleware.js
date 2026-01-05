/**
 * HTTPS enforcement middleware
 * Redirects HTTP to HTTPS in production
 */
export const enforceHTTPS = (req, res, next) => {
  // Skip HTTPS enforcement in development
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  // Check if request is secure (HTTPS)
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';

  if (!isSecure) {
    // Redirect to HTTPS
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }

  next();
};

