# Mobile App Integration Guide

This document outlines the backend configuration to ensure mobile app requests are not blocked.

## CORS Configuration

The backend is configured to allow requests from mobile apps:

- **No Origin Requests**: Mobile apps (React Native, Expo) don't send an `Origin` header. The CORS configuration explicitly allows requests with no origin:
  ```javascript
  if (!origin) return callback(null, true);
  ```

- **Allowed Headers**: The following headers are allowed:
  - `Content-Type`
  - `Authorization` (for Bearer tokens)
  - `X-Requested-With`
  - `X-Request-ID`
  - `Accept`
  - `Accept-Language`
  - `Cache-Control`

- **Exposed Headers**: Mobile apps can access:
  - `X-Request-ID`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`

## Authentication

### Clerk Bearer Token Support

The backend uses Clerk's `clerkMiddleware` and `requireAuth()` which automatically handle Bearer tokens from the `Authorization` header:

```javascript
// Mobile apps should send:
Authorization: Bearer <clerk-session-token>
```

### Authentication Middleware

All protected routes use `isAuthenticated` middleware which:
- Automatically extracts Bearer tokens from the `Authorization` header
- Validates tokens using Clerk
- Works seamlessly with both web sessions and mobile app tokens

## Route Protection

All cart routes now require authentication:
- `POST /api/carts/add` - Requires authentication
- `GET /api/carts` - Requires authentication
- `PUT /api/carts/update` - Requires authentication
- `DELETE /api/carts/remove` - Requires authentication

## Error Handling

The error handler provides mobile-friendly error messages:
- **401 Unauthorized**: "Invalid or expired authentication token. Please sign in again."
- Clear error codes for debugging
- Proper status codes for all error types

## Testing Mobile App Requests

To test if the backend accepts mobile app requests:

1. **Check CORS**: Send a request without an `Origin` header (simulating mobile app)
2. **Check Authentication**: Send a request with `Authorization: Bearer <token>` header
3. **Check Error Messages**: Verify error responses are clear and actionable

## Environment Variables

Ensure these are set in your `.env` file:
- `CLERK_SECRET_KEY` - Required for token validation
- `CORS_ORIGINS` - Optional, comma-separated list of web origins (mobile apps don't need this)

## Common Issues

### Issue: CORS Error
**Solution**: The backend already allows requests with no origin. If you see CORS errors, check:
- The request is not including an invalid `Origin` header
- The backend is running and accessible

### Issue: 401 Unauthorized
**Solution**: 
- Ensure the mobile app is sending the token in the `Authorization: Bearer <token>` header
- Verify the token is valid and not expired
- Check that `CLERK_SECRET_KEY` is set correctly

### Issue: 403 Forbidden
**Solution**: 
- This means authentication succeeded but the user doesn't have permission
- Check user roles and permissions in Clerk

## Mobile App Setup

In the mobile app (`Nubian`), ensure:

1. **Axios Configuration**: The axios instance automatically adds the Bearer token:
   ```javascript
   // Token is automatically added by axios interceptor
   const response = await axiosInstance.get("/carts");
   ```

2. **Token Manager**: The `useTokenManager` hook initializes token management in the root layout

3. **No Manual Token Passing**: Stores no longer require manual token passing - axios handles it automatically

## Verification

To verify the integration is working:

1. Start the backend server
2. From the mobile app, make an authenticated request (e.g., fetch cart)
3. Check backend logs - you should see:
   - "CORS: Allowing request with no origin (mobile app)"
   - Successful authentication logs
   - No CORS errors

## Support

If you encounter issues:
1. Check backend logs for detailed error messages
2. Verify Clerk token is valid
3. Ensure CORS configuration allows no-origin requests
4. Check that routes are properly protected with `isAuthenticated` middleware

